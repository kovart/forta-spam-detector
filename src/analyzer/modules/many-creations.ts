import { ethers } from 'ethers';

import { TokenContract, TokenStandard } from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { erc20Iface } from '../../contants';
import { retry } from '../../utils/helpers';

// This module analyzes the frequency with which a token creator produces unique tokens.
// If the creator generates tokens excessively, it may suggest spammy behavior.

export const TOO_MANY_CREATIONS_MODULE_KEY = 'TooManyTokenCreations';
export const CREATION_WINDOW_PERIOD = 3 * 31 * 24 * 60 * 60; // 3 months
export const TOKEN_CREATIONS_THRESHOLD = 5;

export type TooManyCreationsModuleMetadata = {
  startTime: number;
  endTime: number;
  createdTokens: string[];
};

class TooManyCreationsModule extends AnalyzerModule {
  static Key = TOO_MANY_CREATIONS_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, provider, memoizer, storage } = params;

    let detected = false;
    let metadata: TooManyCreationsModuleMetadata | undefined = undefined;

    context[TOO_MANY_CREATIONS_MODULE_KEY] = { detected, metadata };

    const memo = memoizer.getScope(token.address);

    const tokens = storage.getTokens().filter((t) => t.deployer === token.deployer);

    if (tokens.length === 0) return;

    // Find the longest list of tokens of all time with respect to window period
    let longestTokenArray: TokenContract[] = [];
    for (let startIndex = 0; startIndex < tokens.length; startIndex++) {
      let createdTokens: TokenContract[] = [];
      for (let t = startIndex; t < tokens.length; t++) {
        const token = tokens[t];

        if (token.timestamp - tokens[startIndex].timestamp > CREATION_WINDOW_PERIOD) break;

        createdTokens.push(token);
      }

      // Rewrite the array of tokens, even if they are the same length.
      // This will allow us to analyze always new tokens.
      if (longestTokenArray.length <= createdTokens.length) {
        longestTokenArray = createdTokens;
      }
    }

    if (longestTokenArray.length > TOKEN_CREATIONS_THRESHOLD) {
      const getHash = (type: TokenStandard, symbol: string, name: string) =>
        [String(type), symbol, name].join(',');

      type Token = {
        address: string;
        symbol: string;
        name: string;
        type: TokenStandard;
      };

      // Check how many tokens are unique
      const tokensByHash = new Map<string, Token[]>();
      const contract = new ethers.Contract(token.address, erc20Iface, provider);
      for (const token of longestTokenArray) {
        try {
          const symbol: string = await memo('symbol', () => retry(contract.symbol()));
          const name: string = await memo('name', () => retry(contract.name()));

          const hash = getHash(token.type, symbol, name);
          const sameTokens = tokensByHash.get(hash) || [];
          sameTokens.push({
            address: token.address,
            type: token.type,
            symbol,
            name,
          });
          tokensByHash.set(hash, sameTokens);
        } catch {
          // Not implemented
        }
      }

      detected = tokensByHash.size > TOKEN_CREATIONS_THRESHOLD;
      metadata = {
        startTime: longestTokenArray[0].timestamp,
        endTime: longestTokenArray[longestTokenArray.length - 1].timestamp,
        createdTokens: tokens.map((t) => t.address),
      };
    }

    context[TOO_MANY_CREATIONS_MODULE_KEY] = { detected, metadata };
  }
}

export default TooManyCreationsModule;
