import { ethers } from 'ethers';
import { chunk } from 'lodash';
import axios from 'axios';

import { isBase64, normalizeMetadataUri, parseBase64, retry } from '../../utils/helpers';
import { TokenStandard } from '../../types';
import { erc721Iface } from '../../contants';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import Logger from '../../utils/logger';

export const NON_UNIQUE_TOKENS_MODULE_KEY = 'Erc721NonUniqueTokens';
export const MIN_NUMBER_OF_TOKENS = 5;
export const MIN_NUMBER_OF_DUPLICATE_TOKENS = 4;

export type NonUniqueTokensModuleMetadata = {
  duplicationType: 'uri' | 'metadata';
  duplicatedItems: { tokenIds: string[]; uri?: string; metadata?: string }[];
};

class Erc721NonUniqueTokensModule extends AnalyzerModule {
  static Key = NON_UNIQUE_TOKENS_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, storage, memoizer, provider } = params;

    let detected = false;
    let metadata: NonUniqueTokensModuleMetadata | undefined = undefined;

    const memo = memoizer.getScope(token.address);

    context[NON_UNIQUE_TOKENS_MODULE_KEY] = { detected, metadata };

    if (token.type !== TokenStandard.Erc721) return;

    const tokenIdSet = new Set<string>();
    for (const event of storage.erc721TransferEventsByToken.get(token.address) || []) {
      tokenIdSet.add(event.tokenId);
    }

    if (tokenIdSet.size < MIN_NUMBER_OF_TOKENS) return;

    const contract = new ethers.Contract(token.address, erc721Iface, provider);

    // Test if the token implements tokenURI() with the first tokenId
    try {
      const tokenId = tokenIdSet.values().next().value;
      memo('tokenURI', [tokenId], () => contract.tokenURI(tokenId));
    } catch (e) {
      Logger.info('ERC721 tokenURI() is not supported:', token.address);
      // tokenURI() not supported
      return;
    }

    const tokenUriByTokenId = new Map<string, string>();
    // The token works well, so let's parallelize the requests
    for (const batch of chunk([...tokenIdSet], 6)) {
      try {
        const uris = await retry(() =>
          Promise.all(
            batch.map((tokenId) => memo('tokenURI', [tokenId], () => contract.tokenURI(tokenId))),
          ),
        );
        uris.forEach((url, i) => tokenUriByTokenId.set(batch[i], url));
      } catch (e) {
        Logger.error(e);
        // Well, something went wrong so that even retry() didn't help
        return;
      }
    }

    // Trick to be able to quit the function, while executing the final code
    await (async () => {
      // Check for duplicate URI
      let duplicatedTokenIdsByUri = new Map<string, string[]>();
      for (const [tokenId, uri] of tokenUriByTokenId) {
        const tokenIds = duplicatedTokenIdsByUri.get(uri) || [];
        tokenIds.push(tokenId);
        duplicatedTokenIdsByUri.set(uri, tokenIds);
      }
      duplicatedTokenIdsByUri = new Map(
        [...duplicatedTokenIdsByUri].filter((entry) => entry[1].length > 1),
      );
      if (duplicatedTokenIdsByUri.size >= MIN_NUMBER_OF_DUPLICATE_TOKENS) {
        detected = true;
        metadata = {
          duplicationType: 'uri',
          duplicatedItems: [...duplicatedTokenIdsByUri.entries()].map(([uri, tokenIds]) => ({
            uri,
            tokenIds,
          })),
        };
        return;
      }

      const metadataByTokenId = new Map<string, object | null>();

      // Parse URI with Base64 encoding
      for (const [tokenId, uri] of tokenUriByTokenId) {
        if (isBase64(uri)) {
          const metadata = parseBase64(uri);
          metadataByTokenId.set(tokenId, metadata);
        }
      }

      // Fetch non Base64-encoded URI
      if (metadataByTokenId.size !== tokenUriByTokenId.size) {
        const entries = [...tokenUriByTokenId]
          // Filter out already processed tokens
          .filter(([tokenId]) => !metadataByTokenId.has(tokenId))
          // Normalize uri
          .map(([tokenId, uri]) => [tokenId, normalizeMetadataUri(uri)])
          // Filter out URI with null value after normalization
          .filter(([, uri]) => uri) as [string, string][];

        for (const batch of chunk(entries, 5)) {
          try {
            const metadataArr = await retry(() =>
              Promise.all(batch.map(([, uri]) => memo('axios.get', [uri], () => axios.get(uri)))),
            );
            metadataArr.forEach((metadata, i) => metadataByTokenId.set(entries[i][0], metadata));
          } catch (e) {
            // Backend error?
            Logger.error(e);
            return;
          }
        }
      }

      // Check for metadata duplication
      let duplicatedTokenIdsByMetadata = new Map<string, string[]>();
      for (const [tokenId, metadata] of metadataByTokenId) {
        if (!metadata) continue;
        const str = JSON.stringify(metadata);
        const tokenIds = duplicatedTokenIdsByMetadata.get(tokenId) || [];
        tokenIds.push(tokenId);
        duplicatedTokenIdsByMetadata.set(str, tokenIds);
      }
      duplicatedTokenIdsByMetadata = new Map(
        [...duplicatedTokenIdsByMetadata].filter((entry) => entry[1].length > 1),
      );

      if (duplicatedTokenIdsByMetadata.size >= MIN_NUMBER_OF_DUPLICATE_TOKENS) {
        detected = true;
        metadata = {
          duplicationType: 'metadata',
          duplicatedItems: [...duplicatedTokenIdsByMetadata.entries()].map(
            ([metadata, tokenIds]) => ({
              tokenIds,
              metadata,
            }),
          ),
        };
      }
    })();

    context[NON_UNIQUE_TOKENS_MODULE_KEY] = { detected, metadata };
  }
}

export default Erc721NonUniqueTokensModule;
