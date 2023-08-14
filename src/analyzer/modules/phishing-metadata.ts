import { ethers } from 'ethers';
import { random } from 'lodash';
import axios from 'axios';

import { erc1155Iface, erc20Iface, erc721Iface } from '../../contants';
import {
  extractLinks,
  getIndicators,
  isBase64,
  normalizeMetadataUri,
  parseBase64,
  retry,
} from '../../utils/helpers';
import { AnalyzerModule, ModuleAnalysisResult, ModuleScanReturn, ScanParams } from '../types';
import { normalizeText } from '../../utils/normalizer';
import { TokenStandard } from '../../types';
import Logger from '../../utils/logger';
import AirdropModule, { AirdropModuleMetadata } from './airdrop';
import SilentMintModule from './silent-mint';
import ObservationTimeModule from './observation-time';

// This module analyzes the metadata of tokens for the presence of a link to a website.
// If such a link is found, it may suggest a phishing attack, particularly in the case of a large airdrop.

export const PHISHING_METADATA_MODULE_KEY = 'PhishingMetadata';
export const PHISHING_NAME_KEYWORDS = [
  'visit',
  'claim',
  'activate',
  'reward',
  'free',
  'bonus',
  'mint',
  'gift',
  'at',
  'access',
  'to',
];
export const PHISHING_NAME_PATTERNS = [
  // $ 3000
  /\$\s*\d+/,
  // 3000 $
  /\d+\s*\$/,
  // $ aave.site
  /\$\s+(http(s)?:\/\/.)?(www\.)?[a-zA-Z0-9]{1,256}([-a-zA-Z0-9@:%._\+~#=]*)\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/,
];
export const PHISHING_DESCRIPTION_KEYWORDS = [
  'visit',
  'claim',
  'activate',
  'reward',
  'gift',
  'free mint',
  'access',
  'bonus',
  'check it',
  'check out',
  'go to',
  'available here',
  'available at',
  'more information',
];
export const PHISHING_DESCRIPTION_PATTERNS = [
  /* presence of NFT value */
  /\$\s*\d+/,
];

export const ERC20_RECEIVERS_THRESHOLD = 499;

export type PhishingModuleMetadata = {
  name?: string;
  symbol?: string;
  urls?: string[];
  descriptionByTokenId?: {
    [tokenId: string]: string;
  };
};

class PhishingMetadataModule extends AnalyzerModule {
  static Key = PHISHING_METADATA_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { context } = params;

    let detected = false;
    let metadata: PhishingModuleMetadata | undefined = {};

    context[PHISHING_METADATA_MODULE_KEY] = { detected, metadata };

    const erc20Phishing = await this.scanErc20Phishing(params);
    detected = erc20Phishing.detected;
    metadata = { ...metadata, ...erc20Phishing.metadata };

    const erc721Phishing = await this.scanErc721Phishing(params);
    detected = detected || erc721Phishing.detected;
    metadata = {
      ...metadata,
      ...erc721Phishing.metadata,
      urls: [...(metadata?.urls || []), ...(erc721Phishing.metadata?.urls || [])],
    };

    const erc1155Phishing = await this.scanErc1155Phishing(params);
    detected = detected || erc1155Phishing.detected;
    metadata = {
      ...metadata,
      ...erc1155Phishing.metadata,
      urls: [...(metadata?.urls || []), ...(erc1155Phishing.metadata?.urls || [])],
    };

    const urlSet = new Set<string>();
    for (const url of metadata.urls || []) {
      const normalizedUrl = url.replace('https://', '');
      urlSet.add(normalizedUrl);
    }

    metadata.urls = [...urlSet];

    context[PHISHING_METADATA_MODULE_KEY] = { detected, metadata };
  }

  private async scanErc20Phishing(
    params: ScanParams,
  ): Promise<ModuleAnalysisResult<PhishingModuleMetadata>> {
    const { token, memoizer, provider, context } = params;

    let detected = false;
    let metadata: PhishingModuleMetadata | undefined = undefined;

    const receivers =
      (context[AirdropModule.Key]?.metadata as AirdropModuleMetadata | undefined)?.receivers
        .length || 0;

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
    const urls = extractLinks(words.join(' '));

    metadata = { name, symbol, urls };

    if (urls.length === 0) return { detected, metadata };

    // Some spam tokens only contain a link
    if (receivers >= ERC20_RECEIVERS_THRESHOLD) {
      return { detected: true, metadata };
    }

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

    // If the token has another triggered indicator, and it has a link, then we assume this is a phishing
    if (!detected && urls.length >= 1) {
      const suspiciousIndicators = getIndicators(context).filter(
        (i) =>
          ![
            AirdropModule.Key,
            ObservationTimeModule.Key,
            PhishingMetadataModule.Key,
            SilentMintModule.Key,
          ].includes(i),
      );

      if (suspiciousIndicators.length >= 1) {
        detected = true;
      }
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
    const tokenIds = [...tokenIdSet].filter((v, index) => index % 50 === 0).slice(0, 15);

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
        const phishing = this.checkPhishingText(description);

        if (phishing.detected) {
          detected = true;
          metadata.descriptionByTokenId = metadata.descriptionByTokenId || {};
          metadata.descriptionByTokenId[tokenId] = tokenMetadata?.description;
          metadata.urls = [...(metadata.urls || []), ...phishing.urls];
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
        const phishing = this.checkPhishingText(description);

        if (phishing.detected) {
          detected = true;
          metadata.descriptionByTokenId = metadata.descriptionByTokenId || {};
          metadata.descriptionByTokenId[tokenId] = tokenMetadata?.description;
          metadata.urls = [...(metadata.urls || []), ...phishing.urls];
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
      .split(/\s/gu)
      .map((v) => normalizeText(v.toLowerCase(), false, true));
  }

  private normalizeText(text: string) {
    return this.getWords(text).join(' ');
  }

  private checkPhishingText(text: string): { detected: boolean; urls: string[] } {
    const description = this.normalizeText(text);

    const urls = [...new Set(extractLinks(description))]
      .filter(
        (url) =>
          // Well-known marketplaces
          !url.match(/blur.io|looksrare.org|opensea.io|x2y2.io|genie.xyz|gem.xyz/m) &&
          // Governance sites
          !url.match(/^(.*\.)?(edu|gov)(\.[a-zA-Z]{2,})?$/m) &&
          // Explorers
          !url.match(
            /etherscan.io|bscscan.com|polygonscan.com|arbiscan.io|snowtrace.io|ftmscan.com/m,
          ) &&
          // Popular sites
          !url.match(/wikipedia|bbc.com|cnn.com/m),
      )
      // Links that are too short are probably incorrectly parsed text (A.A.Murakai -> a.a.mu)
      .filter((url) => url.replace(/\./g, '').length >= 6);

    if (urls.length === 0) return { detected: false, urls };

    // The presence of several social media links is often used in the tokenization of restaurants, establishments, artists, and events
    if ([...description.matchAll(/twitter|facebook|instagram|discord|telegram/gm)].length >= 3) {
      return { detected: false, urls: [] };
    }

    for (const keyword of PHISHING_DESCRIPTION_KEYWORDS) {
      if (description.includes(keyword)) return { detected: true, urls };
    }

    for (const pattern of PHISHING_DESCRIPTION_PATTERNS) {
      if (pattern.test(description)) return { detected: true, urls };
    }

    return { detected: false, urls };
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
          const { data } = await retry(() => axios.get(url), {
            wait: random(5, 15) * 1000,
          });
          return data;
        });
      } catch (e) {
        Logger.debug({ error: e }, 'Metadata fetching error');
      }
    }

    return metadata;
  }
}

export default PhishingMetadataModule;
