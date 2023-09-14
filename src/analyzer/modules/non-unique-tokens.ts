import axios from 'axios';
import { queue } from 'async';
import { ethers } from 'ethers';
import { chunk, random, shuffle } from 'lodash';

import Logger from '../../utils/logger';
import { isBase64, normalizeMetadataUri, parseBase64, retry } from '../../utils/helpers';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { TokenStandard } from '../../types';
import { erc721Iface, FETCH_CONCURRENCY, PROVIDER_CONCURRENCY } from '../../contants';
import { AIRDROP_MODULE_KEY } from './airdrop';
import { TOKEN_IMPERSONATION_MODULE_KEY } from './token-impersonation';

export const NON_UNIQUE_TOKENS_MODULE_KEY = 'Erc721NonUniqueTokens';
export const MIN_NUMBER_OF_TOKENS = 5;
export const MIN_NUMBER_OF_DUPLICATE_TOKENS = 4;
export const MAX_NUMBER_OF_TOKENS = 700;

type DuplicatedItem = { tokenIds: string[]; uri?: string; metadata?: string };

export type NonUniqueTokensModuleMetadata = {
  duplicationType: 'uri' | 'metadata';
  duplicatedItems: DuplicatedItem[];
};

export type NonUniqueTokensModuleShortMetadata = {
  duplicationType: 'uri' | 'metadata';
  duplicatedItemShortList: DuplicatedItem[];
};

class Erc721NonUniqueTokensModule extends AnalyzerModule {
  static Key = NON_UNIQUE_TOKENS_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, storage, memoizer, provider } = params;

    let detected = false;
    let metadata: NonUniqueTokensModuleMetadata | undefined = undefined;

    context[NON_UNIQUE_TOKENS_MODULE_KEY] = { detected, metadata };

    if (![AIRDROP_MODULE_KEY, TOKEN_IMPERSONATION_MODULE_KEY].some((key) => context[key]?.detected))
      return;

    const memo = memoizer.getScope(token.address);

    const isTokenURISupported = memo.get<boolean>('isTokenURISupported');

    if (token.type !== TokenStandard.Erc721) return;
    if (isTokenURISupported != null && !isTokenURISupported) return;

    let tokenIdSet = new Set<string>();
    for (const event of await storage.getErc721TransferEvents(token.address)) {
      tokenIdSet.add(event.tokenId.toString());
    }

    if (tokenIdSet.size < MIN_NUMBER_OF_TOKENS) return;
    if (tokenIdSet.size > MAX_NUMBER_OF_TOKENS) {
      tokenIdSet = memo('tokenIdSet', () => {
        Logger.debug(
          `Too many tokens to check: ${tokenIdSet.size}. Limiting to ${MAX_NUMBER_OF_TOKENS}.`,
        );
        return new Set(shuffle([...tokenIdSet]).slice(0, MAX_NUMBER_OF_TOKENS));
      });
    }

    const contract = new ethers.Contract(token.address, erc721Iface, provider);

    // Test if the token implements tokenURI() with the first tokenId
    try {
      const tokenId = tokenIdSet.values().next().value;
      await memo('tokenURI', [tokenId], () => contract.tokenURI(tokenId));
    } catch (e) {
      Logger.info('ERC721 tokenURI() is not supported:', token.address);
      // tokenURI() not supported
      memo.set('isTokenURISupported', false);
      return;
    }

    memo.set('isTokenURISupported', true);

    Logger.debug(`Fetching token URIs: ${tokenIdSet.size} items`);

    const tokenUriByTokenId = new Map<string, string>();
    // The token works well, so let's parallelize the requests
    for (const batch of chunk([...tokenIdSet], PROVIDER_CONCURRENCY)) {
      try {
        const uris = await Promise.all(
          batch.map((tokenId) =>
            memo('tokenURI', [tokenId], () =>
              retry(() => contract.tokenURI(tokenId) as Promise<string>),
            ),
          ),
        );
        uris.forEach((url, i) => tokenUriByTokenId.set(batch[i], url));
      } catch (e) {
        Logger.error(e, 'token uri error');
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
        if (memo.get('isMetadataProviderBroken')) return;

        const entries = [...tokenUriByTokenId]
          // Filter out already processed tokens
          .filter(([tokenId]) => !metadataByTokenId.has(tokenId))
          // Normalize uri
          .map(([tokenId, uri]) => [tokenId, normalizeMetadataUri(uri)])
          // Filter out URI with null value after normalization
          .filter(([, uri]) => uri) as [string, string][];

        const metadataQueue = queue<{ tokenId: string; uri: string }>(
          async ({ tokenId, uri }, callback) => {
            try {
              const metadata = await memo('axios.get', [uri], async () => {
                const { data } = await retry(() => axios.get(uri), {
                  attempts: 3,
                  wait: random(2, 8, true) * 1000,
                });
                return data;
              });

              metadataByTokenId.set(tokenId, metadata);
              callback();
            } catch (e) {
              Logger.error(e, 'MetadataQueue error');
              memo.set('isMetadataProviderBroken', true);
              metadataQueue.remove((v) => true);
              callback();
            }
          },
          FETCH_CONCURRENCY,
        );

        Logger.debug(`Fetching token metadata: ${tokenUriByTokenId.size} items`);
        for (const [tokenId, uri] of entries) {
          metadataQueue.push({ tokenId, uri });
        }

        if (!metadataQueue.idle()) {
          await metadataQueue.drain();
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

  simplifyMetadata(metadata: NonUniqueTokensModuleMetadata): NonUniqueTokensModuleShortMetadata {
    return {
      duplicationType: metadata.duplicationType,
      duplicatedItemShortList: metadata.duplicatedItems.slice(0, 15),
    };
  }
}

export default Erc721NonUniqueTokensModule;
