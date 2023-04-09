import { queue } from 'async';

import Logger from '../../utils/logger';
import HoneyPotChecker, { HoneypotAnalysisMetadata } from '../../utils/honeypot';
import AirdropModule, { AirdropModuleMetadata } from './airdrop';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { isBurnAddress } from '../../utils/helpers';
import { PROVIDER_CONCURRENCY } from '../../contants';

// This module checks if a suspiciously large number of token holders are Honeypots,
// i.e., popular addresses such as vitalik.eth.

export const TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY = 'TooManyHoneyPotOwners';
export const HONEYPOT_THRESHOLD_RATIO = 0.5;
export const MAX_HOLDERS = 1500;

type HoneypotInfo = { address: string; metadata: HoneypotAnalysisMetadata };

export type TooManyHoneyPotOwnersModuleMetadata = {
  honeypots: HoneypotInfo[];
  honeypotRatio: number;
  holderCount: number;
};

export type TooManyHoneyPotOwnersModuleShortMetadata = {
  honeypotCount: number;
  honeypotShortList: HoneypotInfo[];
  honeypotRatio: number;
  holderCount: number;
};

class TooManyHoneyPotOwnersModule extends AnalyzerModule {
  static Key = TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY;

  constructor(private honeypotChecker: HoneyPotChecker) {
    super();
  }

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, provider, memoizer, transformer, blockNumber } = params;

    let detected = false;
    let metadata: TooManyHoneyPotOwnersModuleMetadata | undefined = undefined;

    context[TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY] = { detected, metadata };

    const memo = memoizer.getScope(token.address);

    const airdropMetadata = context[AirdropModule.Key].metadata as AirdropModuleMetadata;

    let receiverSet = new Set(airdropMetadata.receivers);
    const transactionSet = transformer.transactions(token);
    const senderSet = new Set([...transactionSet].map((t) => t.from));

    // Creators often allocate tokens to themselves
    receiverSet.delete(token.deployer);
    receiverSet.delete(token.address);

    for (const receiver of receiverSet) {
      // Delete all burn addresses and all receivers that interacted with the token
      if (isBurnAddress(receiver) || senderSet.has(receiver)) {
        receiverSet.delete(receiver);
      }
    }

    if (receiverSet.size > MAX_HOLDERS) {
      Logger.debug(`Too many token holders to check the number of honeypots: ${receiverSet.size}`);
      return;
    }

    const honeypots: HoneypotInfo[] = [];
    const holderQueue = queue<string>(async (receiver, callback) => {
      try {
        const { isHoneypot, metadata } = await memo('honeypot', [receiver], () => {
          Logger.debug(`HoneyPot scanning: ${receiver}`);
          return this.honeypotChecker.testAddress(receiver, provider, blockNumber);
        });

        if (isHoneypot) {
          honeypots.push({ address: receiver, metadata: metadata });
        }

        callback();
      } catch (e: any) {
        Logger.error('holderQueue error', { error: e });
        holderQueue.remove(() => true);
        callback();
      }
    }, PROVIDER_CONCURRENCY);

    Logger.debug(`Fetching honeypot info for ${receiverSet.size} accounts...`);
    for (const holder of receiverSet) {
      holderQueue.push(holder);
    }

    if (!holderQueue.idle()) {
      await holderQueue.drain();
    }

    const honeypotRatio = honeypots.length / receiverSet.size;
    detected = honeypotRatio >= HONEYPOT_THRESHOLD_RATIO;
    if (detected) {
      metadata = { honeypots, honeypotRatio, holderCount: receiverSet.size };
    }

    context[TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY] = { detected, metadata };
  }

  simplifyMetadata(
    metadata: TooManyHoneyPotOwnersModuleMetadata,
  ): TooManyHoneyPotOwnersModuleShortMetadata {
    return {
      holderCount: metadata.holderCount,
      honeypotCount: metadata.honeypots.length,
      honeypotShortList: metadata.honeypots.slice(0, 15),
      honeypotRatio: metadata.honeypotRatio,
    };
  }
}

export default TooManyHoneyPotOwnersModule;
