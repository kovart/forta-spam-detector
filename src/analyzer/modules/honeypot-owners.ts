import { queue } from 'async';

import Logger from '../../utils/logger';
import HoneyPotChecker, { HoneypotAnalysisMetadata } from '../../utils/honeypot';
import AirdropModule, { AIRDROP_MODULE_KEY, AirdropModuleMetadata } from './airdrop';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { isBurnAddress } from '../../utils/helpers';
import { PROVIDER_CONCURRENCY } from '../../contants';

// This module checks if a suspiciously large number of token holders are Honeypots,
// i.e., popular addresses such as vitalik.eth.

export const TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY = 'TooManyHoneyPotOwners';
export const HONEYPOT_THRESHOLD_RATIO = 0.5;
export const MAX_HOLDERS = 1500;
export const MAX_CEX_HOLDERS = 6;

type HoneypotInfo = { address: string; metadata: HoneypotAnalysisMetadata };

type CEXInfo = { address: string; nonce: number };

export type TooManyHoneyPotOwnersModuleMetadata = {
  cexs: CEXInfo[];
  honeypots: HoneypotInfo[];
  honeypotRatio: number;
  cexCount: number;
  honeypotCount: number;
  holderCount: number;
};

export type TooManyHoneyPotOwnersModuleShortMetadata = {
  cexShortList: CEXInfo[];
  honeypotShortList: HoneypotInfo[];
  cexCount: number;
  honeypotCount: number;
  holderCount: number;
  honeypotRatio: number;
};

class TooManyHoneyPotOwnersModule extends AnalyzerModule {
  static Key = TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY;

  constructor(private honeypotChecker: HoneyPotChecker) {
    super();
  }

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, provider, memoizer, blockNumber } = params;

    let detected = false;
    let metadata: TooManyHoneyPotOwnersModuleMetadata | undefined = undefined;

    context[TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY] = { detected, metadata };

    if (!context[AIRDROP_MODULE_KEY]?.detected) return;

    const memo = memoizer.getScope(token.address);

    const airdropMetadata = context[AirdropModule.Key].metadata as AirdropModuleMetadata;
    const receiverSet = new Set(airdropMetadata.receivers);

    // Creators often allocate tokens to themselves
    receiverSet.delete(token.deployer);
    receiverSet.delete(token.address);

    for (const receiver of receiverSet) {
      // Delete all burn addresses
      if (isBurnAddress(receiver)) {
        receiverSet.delete(receiver);
      }
    }

    if (receiverSet.size > MAX_HOLDERS) {
      Logger.debug(`Too many token holders to check the number of honeypots: ${receiverSet.size}`);
      return;
    }

    const honeypots: HoneypotInfo[] = [];
    const cexs: CEXInfo[] = [];
    const holderQueue = queue<string>(async (receiver, callback) => {
      try {
        await provider.ready;
        const { isHoneypot, metadata } = await memo('honeypot', [receiver], () => {
          Logger.debug(`HoneyPot scanning: ${receiver}`);
          return this.honeypotChecker.testAddress(receiver, provider, blockNumber);
        });

        const isCEX = metadata.CEX?.detected || false;

        if (isCEX) {
          cexs.push({ address: receiver, nonce: metadata.CEX?.nonce ?? 0 });
        }

        if (isHoneypot) {
          honeypots.push({ address: receiver, metadata: metadata });
        }

        callback();
      } catch (e: any) {
        Logger.error(e, 'holderQueue error');
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

    detected = cexs.length > MAX_CEX_HOLDERS || honeypotRatio >= HONEYPOT_THRESHOLD_RATIO;
    metadata = {
      cexs,
      honeypots,
      honeypotRatio,
      cexCount: cexs.length,
      honeypotCount: honeypots.length,
      holderCount: receiverSet.size,
    };

    context[TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY] = { detected, metadata };
  }

  simplifyMetadata(
    metadata: TooManyHoneyPotOwnersModuleMetadata,
  ): TooManyHoneyPotOwnersModuleShortMetadata {
    return {
      holderCount: metadata.holderCount,
      cexCount: metadata.cexs.length,
      honeypotCount: metadata.honeypots.length,
      honeypotShortList: metadata.honeypots.slice(0, 15),
      cexShortList: metadata.cexs.slice(0, 15),
      honeypotRatio: metadata.honeypotRatio,
    };
  }
}

export default TooManyHoneyPotOwnersModule;
