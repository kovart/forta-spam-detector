import { ethers } from 'ethers';

import { erc20Iface } from '../../contants';
import { containsLink } from '../../utils/helpers';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import AirdropModule, { AirdropModuleMetadata } from './airdrop';

// This module analyzes the metadata of tokens for the presence of a link to a website.
// If such a link is found, it may suggest a phishing attack, particularly in the case of a large airdrop.

export const PHISHING_METADATA_MODULE_KEY = 'PhishingMetadata';
export const MIN_RECEIVERS = 500;

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

    context[PHISHING_METADATA_MODULE_KEY] = { detected, metadata };

    const airdropMetadata = context[AirdropModule.Key].metadata as AirdropModuleMetadata;

    if (airdropMetadata.receivers.length < MIN_RECEIVERS) return;

    const memo = memoizer.getScope(token.address);

    const contract = new ethers.Contract(token.address, erc20Iface, provider);

    let symbol: string = '';
    let name: string = '';

    try {
      symbol = await memo('symbol', () => contract.symbol());
    } catch {
      // not implemented
    }

    try {
      name = await memo('name', () => contract.name());
    } catch {
      // not implemented
    }

    if (containsLink(name) || containsLink(symbol)) {
      detected = true;
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
