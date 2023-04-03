import BigNumber from 'bignumber.js';
import { queue } from 'async';

import Logger from '../../utils/logger';
import HoneyPotChecker, { HoneypotAnalysisMetadata } from '../../utils/honeypot';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { AIRDROP_MODULE_KEY, AirdropModuleMetadata } from './airdrop';

export const TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY = 'TooManyHoneyPotOwners';
export const MIN_HONEYPOT_ACCOUNTS = 100;
export const MIN_HONEYPOT_RATIO = 0.35;
export const MAX_ACCOUNTS = 1000;
export const MIN_ACCOUNTS = 10;
export const CONCURRENCY = 20;

type Honeypot = { address: string; metadata: HoneypotAnalysisMetadata };

export type TooManyHoneyPotOwnersModuleMetadata = {
  honeypots: Honeypot[];
};

export type TooManyHoneyPotOwnersModuleShortMetadata = {
  honeypotCount: number;
  honeypotShortList: Honeypot[];
};

class TooManyHoneyPotOwnersModule extends AnalyzerModule {
  static Key = TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY;

  constructor(private honeypotChecker: HoneyPotChecker) {
    super();
  }

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, provider, transformer, memoizer, blockNumber } = params;

    let detected = false;
    let metadata: TooManyHoneyPotOwnersModuleMetadata | undefined = undefined;

    const memo = memoizer.getScope(token.address);

    const airdropMetadata = context[AIRDROP_MODULE_KEY].metadata as AirdropModuleMetadata;

    const honeypots: Honeypot[] = [];

    if (airdropMetadata) {
      // Use the cache, but clone it, since we will be modifying it
      const balanceByAccount = new Map(
        memo('balanceByAccount', [blockNumber], () => transformer.balanceByAccount(token)),
      );

      // Creators often allocate most of the tokens to themselves
      balanceByAccount.delete(token.deployer);
      balanceByAccount.delete(token.address);

      let receivers = airdropMetadata.receivers;

      if (receivers.length < MIN_ACCOUNTS) return;

      // It takes a very long time to process all the accounts.
      // So, we will try to "cheat" and filter accounts with the highest balance.
      if (receivers.length > MAX_ACCOUNTS) {
        receivers.sort((r1, r2) => {
          const balanceR1 = balanceByAccount.get(r1) || new BigNumber(0);
          const balanceR2 = balanceByAccount.get(r2) || new BigNumber(0);
          return balanceR1.isGreaterThan(balanceR2) ? 0 : -1;
        });

        receivers = receivers.slice(0, MAX_ACCOUNTS);
      }

      let counter = 0;
      const receiverQueue = queue<string>(async (receiver, callback) => {
        Logger.debug(
          `[${counter}/${receivers.length}] Testing address if it is a honeypot: ${receiver}`,
        );

        try {
          const result = await memo('honeypot', [receiver], () =>
            this.honeypotChecker.testAddress(receiver, provider, blockNumber),
          );

          if (result.isHoneypot) {
            honeypots.push({ address: receiver, metadata: result.metadata });
          }

          counter++;
          callback();
        } catch (e: any) {
          Logger.error(e);
          receiverQueue.kill();
        }
      }, CONCURRENCY);

      for (let i = 0; i < receivers.length; i++) {
        const receiver = receivers[i];

        if (receiver === token.deployer || receiver === token.address) continue;

        receiverQueue.push(receiver);
      }

      if (!receiverQueue.idle()) {
        await receiverQueue.drain();
      }

      const honeypotRate = honeypots.length / receivers.length;
      if (honeypots.length >= MIN_HONEYPOT_ACCOUNTS || honeypotRate >= MIN_HONEYPOT_RATIO) {
        detected = true;
        metadata = { honeypots };
      }
    }

    context[TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY] = { detected, metadata };
  }

  simplifyMetadata(
    metadata: TooManyHoneyPotOwnersModuleMetadata,
  ): TooManyHoneyPotOwnersModuleShortMetadata {
    return {
      honeypotCount: metadata.honeypots.length,
      honeypotShortList: metadata.honeypots.slice(0, 15),
    };
  }
}

export default TooManyHoneyPotOwnersModule;
