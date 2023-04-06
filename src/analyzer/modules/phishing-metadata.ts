import { ethers } from 'ethers';

import { erc20Iface } from '../../contants';
import { containsLink, retry } from '../../utils/helpers';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { normalizeText } from '../../utils/normalizer';

// This module analyzes the metadata of tokens for the presence of a link to a website.
// If such a link is found, it may suggest a phishing attack, particularly in the case of a large airdrop.

export const PHISHING_METADATA_MODULE_KEY = 'PhishingMetadata';
export const PHISHING_KEYWORDS = ['visit', 'claim', 'activate', 'reward', 'free', 'mint'];
export const PHISHING_PATTERNS = [
  // $ 3000
  /\$\s*\d+/,
  // $ aave.site
  /\$\s+(http(s)?:\/\/.)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/,
];

export type PhishingModuleMetadata = {
  name: string;
  symbol: string;
};

class PhishingMetadataModule extends AnalyzerModule {
  static Key = PHISHING_METADATA_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, memoizer, provider, context } = params;

    let detected = false;
    let metadata: PhishingModuleMetadata | undefined = undefined;

    const memo = memoizer.getScope(token.address);

    const contract = new ethers.Contract(token.address, erc20Iface, provider);

    let symbol: string = '';
    let name: string = '';

    try {
      symbol = await memo('symbol', () => retry(() => contract.symbol()));
    } catch {
      // not implemented
    }

    try {
      name = await memo('name', () => retry(() => contract.name()));
    } catch {
      // not implemented
    }

    if ([name, symbol].find(containsLink)) {
      for (const word of [name, symbol].join(' ').split(' ').map(normalizeText)) {
        if (PHISHING_KEYWORDS.includes(word)) {
          detected = true;
          break;
        }
      }

      if (!detected) {
        for (const text of [name, symbol]) {
          detected = !!PHISHING_PATTERNS.find((pattern) => pattern.test(text));
          if (detected) break;
        }
      }

      metadata = {
        name,
        symbol,
      };
    }

    // TODO Test Erc721 description

    context[PHISHING_METADATA_MODULE_KEY] = { detected, metadata };

    return {};
  }
}

export default PhishingMetadataModule;
