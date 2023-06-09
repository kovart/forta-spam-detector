import { ethers } from 'ethers';
import axios from 'axios';

import { erc1155Iface, erc20Iface, erc721Iface } from '../../contants';
import {
  containsLink,
  isBase64,
  normalizeMetadataUri,
  parseBase64,
  retry,
} from '../../utils/helpers';
import { AnalyzerModule, ModuleAnalysisResult, ModuleScanReturn, ScanParams } from '../types';
import { normalizeText } from '../../utils/normalizer';
import { TokenStandard } from '../../types';
import Logger from '../../utils/logger';

// This module analyzes the metadata of tokens for the presence of a link to a website.
// If such a link is found, it may suggest a phishing attack, particularly in the case of a large airdrop.

export const PHISHING_METADATA_MODULE_KEY = 'PhishingMetadata';
export const PHISHING_NAME_KEYWORDS = [
  'visit',
  'claim',
  'activate',
  'reward',
  'free',
  'mint',
  'gift',
  'at',
];
export const PHISHING_NAME_PATTERNS = [
  // $ 3000
  /\$\s*\d+/,
  // $ aave.site
  /\$\s+(http(s)?:\/\/.)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/,
];
export const PHISHING_DESCRIPTION_KEYWORDS = [
  'visit',
  'claim',
  'activate',
  'reward',
  'gift',
  'free mint',
  'coupon',
  'check it',
  'check out',
  'go to',
  'available here',
  'available at',
];
export const PHISHING_DESCRIPTION_PATTERNS = [
  /* presence of NFT value */
  /\$\s*\d+/,
];

export type PhishingModuleMetadata = {
  name?: string;
  symbol?: string;
  descriptionByTokenId?: {
    [tokenId: string]: string;
  };
};

class PhishingMetadataModule extends AnalyzerModule {
  static Key = PHISHING_METADATA_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { context } = params;

    let detected = false;
    let metadata: PhishingModuleMetadata | undefined = undefined;

    context[PHISHING_METADATA_MODULE_KEY] = { detected, metadata };

    const erc20Phishing = await this.scanErc20Phishing(params);
    if (erc20Phishing.detected) {
      context[PHISHING_METADATA_MODULE_KEY] = erc20Phishing;
      return;
    }

    const erc721Phishing = await this.scanErc721Phishing(params);
    if (erc721Phishing.detected) {
      context[PHISHING_METADATA_MODULE_KEY] = erc721Phishing;
      return;
    }

    const erc1155Phishing = await this.scanErc1155Phishing(params);
    if (erc1155Phishing.detected) {
      context[PHISHING_METADATA_MODULE_KEY] = erc1155Phishing;
      return;
    }
  }

  private async scanErc20Phishing(
    params: ScanParams,
  ): Promise<ModuleAnalysisResult<PhishingModuleMetadata>> {
    const { token, memoizer, provider } = params;

    let detected = false;
    let metadata: PhishingModuleMetadata | undefined = undefined;

    const memo = memoizer.getScope(token.address);

    const contract = new ethers.Contract(token.address, erc20Iface, provider);

    let symbol: string = '';
    let name: string = '';

    try {
      symbol = await memo('symbol', () => retry(() => contract.symbol()));
    } catch {
      // not supported
    }

    try {
      name = await memo('name', () => retry(() => contract.name()));
    } catch {
      // not supported
    }

    const words = this.getWords([name, symbol].join(' '));
    if (words.find(containsLink)) {
      for (const word of words) {
        if (PHISHING_NAME_KEYWORDS.includes(word)) {
          detected = true;
          break;
        }
      }

      if (!detected) {
        for (const text of [name, symbol]) {
          detected = !!PHISHING_NAME_PATTERNS.find((pattern) => pattern.test(text));
          if (detected) break;
        }
      }

      metadata = { name, symbol };
    }

    return { detected, metadata };
  }

  private async scanErc721Phishing(
    params: ScanParams,
  ): Promise<ModuleAnalysisResult<PhishingModuleMetadata>> {
    const { token, memoizer, storage, provider } = params;

    let detected = false;
    let metadata: PhishingModuleMetadata | undefined = {};

    const emptyResult: ModuleAnalysisResult<PhishingModuleMetadata> = { detected, metadata };

    if (token.type !== TokenStandard.Erc721) return emptyResult;

    const memo = memoizer.getScope(token.address);

    if (memo.get('isMetadataProviderBroken')) return emptyResult;
    const isTokenURISupported = memo.get<boolean>('isTokenURISupported');
    if (isTokenURISupported != null && !isTokenURISupported) return emptyResult;

    let tokenIdSet = new Set<string>();
    for (const event of await storage.getErc721TransferEvents(token.address)) {
      tokenIdSet.add(event.tokenId.toString());
    }

    // in order to optimize performance we only check each 50th token
    const tokenIds = [...tokenIdSet].filter((v, index) => index % 50 === 0);

    try {
      const erc721Contract = new ethers.Contract(token.address, erc721Iface, provider);

      for (const tokenId of tokenIds) {
        const uri = await memo('tokenURI', [tokenId], () =>
          retry<string>(() => erc721Contract.tokenURI(tokenId)),
        );

        const tokenMetadata = await this.getUriMetadata(uri, params);

        if (!tokenMetadata) {
          memo.set('isMetadataProviderBroken', true);
          break;
        }

        const description: string = tokenMetadata.description;

        if (this.isPhishingDescription(description)) {
          detected = true;
          metadata.descriptionByTokenId = metadata.descriptionByTokenId || {};
          metadata.descriptionByTokenId[tokenId] = tokenMetadata?.description;
        }
      }
    } catch (e) {
      Logger.info('ERC721 tokenURI() is not supported:', token.address);
      // tokenURI() not supported
      memo.set('isTokenURISupported', false);
    }

    return { detected, metadata };
  }

  private async scanErc1155Phishing(
    params: ScanParams,
  ): Promise<ModuleAnalysisResult<PhishingModuleMetadata>> {
    const { token, memoizer, storage, provider } = params;

    let detected = false;
    let metadata: PhishingModuleMetadata | undefined = {};

    const emptyResult: ModuleAnalysisResult<PhishingModuleMetadata> = { detected, metadata };

    if (token.type !== TokenStandard.Erc1155) return emptyResult;

    const memo = memoizer.getScope(token.address);

    if (memo.get('isMetadataProviderBroken')) return emptyResult;
    const isTokenURISupported = memo.get<boolean>('isTokenURISupported');
    if (isTokenURISupported != null && !isTokenURISupported) return emptyResult;

    let tokenIdSet = new Set<string>();
    for (const event of await storage.getErc1155TransferSingleEvents(token.address)) {
      tokenIdSet.add(event.tokenId.toString());
    }
    for (const event of await storage.getErc1155TransferBatchEvents(token.address)) {
      for (const tokenId of event.ids) {
        tokenIdSet.add(tokenId.toString());
      }
    }

    // in order to optimize performance we only check each 50th token
    const tokenIds = [...tokenIdSet].filter((v, index) => index % 50 === 0);

    try {
      const erc1155Contract = new ethers.Contract(token.address, erc1155Iface, provider);

      for (const tokenId of tokenIds) {
        const uri = await memo('tokenURI', [tokenId], () =>
          retry<string>(() => erc1155Contract.uri(tokenId)),
        );

        const tokenMetadata = await this.getUriMetadata(uri, params);

        if (!tokenMetadata) {
          memo.set('isMetadataProviderBroken', true);
          break;
        }

        const description: string = tokenMetadata.description;

        if (this.isPhishingDescription(description)) {
          detected = true;
          metadata.descriptionByTokenId = metadata.descriptionByTokenId || {};
          metadata.descriptionByTokenId[tokenId] = tokenMetadata?.description;
        }
      }
    } catch (e) {
      Logger.info('ERC721 tokenURI() is not supported:', token.address);
      // tokenURI() not supported
      memo.set('isTokenURISupported', false);
    }

    return { detected, metadata };
  }

  private getWords(text: string) {
    return text
      .replace(/\[.\]/g, '.')
      .replace(/\[dot\]/g, '.')
      .split(' ')
      .map((v) => normalizeText(v.toLowerCase()));
  }

  private normalizeText(text: string) {
    return this.getWords(text).join(' ');
  }

  private isPhishingDescription(text: string) {
    const description = this.normalizeText(text);

    if (!containsLink(description)) return false;

    for (const keyword of PHISHING_DESCRIPTION_KEYWORDS) {
      if (description.includes(keyword)) return true;
    }

    for (const pattern of PHISHING_DESCRIPTION_PATTERNS) {
      if (pattern.test(description)) return true;
    }

    return false;
  }

  private async getUriMetadata(uri: string, params: ScanParams): Promise<Record<any, any> | null> {
    const { memoizer, token } = params;
    const memo = memoizer.getScope(token.address);

    let metadata: any | null = null;

    if (isBase64(uri)) {
      metadata = parseBase64(uri);
    } else {
      const url = normalizeMetadataUri(uri);
      if (!url) return null;

      try {
        metadata = await memo('axios.get', [url], async () => {
          const { data } = await retry(() => axios.get(url));
          return data;
        });
      } catch (e) {
        Logger.error('Metadata fetching error', { error: e });
      }
    }

    return metadata;
  }
}

export default PhishingMetadataModule;
