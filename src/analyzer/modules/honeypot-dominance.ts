import BigNumber from 'bignumber.js';
import { queue } from 'async';

import Logger from '../../utils/logger';
import HoneyPotChecker from '../../utils/honeypot';
import AirdropModule, { AirdropModuleMetadata } from './airdrop';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { isBurnAddress } from '../../utils/helpers';
import { PROVIDER_CONCURRENCY } from '../../contants';

// This module checks whether the share of honeypot accounts is unfairly large.
// An example of a token that has unfair share:
// https://etherscan.io/token/0x7de45d86199a2e4f9d8bf45bfd4a578886b48d3c#balances

// Exception:
// https://etherscan.io/token/0x5ca9a71b1d01849c0a95490cc00559717fcf0d1d#balances

export const HONEY_POT_SHARE_MODULE_KEY = 'HoneypotShareDominance';
export const HONEYPOT_SHARE_THRESHOLD = 0.5;

type HoneypotShare = {
  address: string;
  share: number;
};

export type HoneyPotShareModuleMetadata = {
  honeypots: HoneypotShare[];
  honeypotTotalShare: number;
};

export type HoneyPotShareModuleShortMetadata = {
  honeypotCount: number;
  honeypotShortList: HoneypotShare[];
  honeypotTotalShare: number;
};

class HoneyPotShareDominanceModule extends AnalyzerModule {
  static Key = HONEY_POT_SHARE_MODULE_KEY;

  constructor(private honeypotChecker: HoneyPotChecker) {
    super();
  }

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, memoizer, provider, transformer, blockNumber, context } = params;

    let detected = false;
    let metadata: HoneyPotShareModuleMetadata | undefined = undefined;

    context[HONEY_POT_SHARE_MODULE_KEY] = { detected, metadata };

    const memo = memoizer.getScope(token.address);
    const balanceByAccount = await transformer.balanceByAccount(token);

    // Check if there are artifacts in the balances
    if ([...balanceByAccount.values()].find((e) => e.isNegative())) {
      return;
    }

    const airdropMetadata = context[AirdropModule.Key].metadata as AirdropModuleMetadata;
    const receiverSet = new Set(airdropMetadata.receivers);
    const transactionSet = await transformer.transactions(token);
    const senderSet = new Set([...transactionSet].map((t) => t.from));

    for (const receiver of receiverSet) {
      if (isBurnAddress(receiver) || senderSet.has(receiver)) receiverSet.delete(receiver);
    }

    // Creators often allocate most of the tokens to themselves, so we will remove this share
    receiverSet.delete(token.deployer);
    receiverSet.delete(token.address);
    balanceByAccount.delete(token.deployer);
    balanceByAccount.delete(token.address);

    const balances = [...balanceByAccount.values()];
    const totalBalance = this.sum(balances);

    type Account = {
      address: string;
      balance: BigNumber;
    };

    const honeypotReceivers: Account[] = [];
    const honeypotQueue = queue<Account>(async (account, callback) => {
      const { address } = account;

      try {
        const { isHoneypot } = await memo('honeypot', [address], () => {
          Logger.trace(`HoneyPot scanning: ${address}`);
          return this.honeypotChecker.testAddress(address, provider, blockNumber);
        });

        if (isHoneypot) {
          honeypotReceivers.push(account);
        }

        callback();
      } catch (e: any) {
        Logger.error('honeypotQueue error', { error: e });
        honeypotQueue.remove(() => true);
        callback();
      }
    }, PROVIDER_CONCURRENCY);

    const balanceByReceiver: Account[] = [...receiverSet].map((r) => ({
      address: r,
      balance: balanceByAccount.get(r) || new BigNumber(0),
    }));
    balanceByReceiver.sort((a1, a2) => (a2.balance.isGreaterThan(a1.balance) ? 0 : -1));

    // Push top 100 receivers by balance
    for (const account of balanceByReceiver.slice(0, 100)) {
      honeypotQueue.push(account);
    }

    if (!honeypotQueue.idle()) {
      await honeypotQueue.drain();
    }

    // Check total share percentage
    const honeypotTotalShare = this.sum(honeypotReceivers.map((a) => a.balance))
      .div(totalBalance)
      .toNumber();

    detected = honeypotTotalShare > HONEYPOT_SHARE_THRESHOLD;
    if (detected) {
      metadata = {
        honeypots: honeypotReceivers.map((account) => ({
          address: account.address,
          share: new BigNumber(account.balance).div(totalBalance).toNumber(),
        })),
        honeypotTotalShare: honeypotTotalShare,
      };
    }

    context[HONEY_POT_SHARE_MODULE_KEY] = { detected, metadata };
  }

  private sum(arr: (string | BigNumber)[]) {
    let total = new BigNumber(0);
    for (const value of arr) {
      total = total.plus(value);
    }
    return total;
  }

  simplifyMetadata(metadata: HoneyPotShareModuleMetadata): HoneyPotShareModuleShortMetadata {
    const sortedHoneyPotList = metadata.honeypots.slice();
    sortedHoneyPotList.sort((h1, h2) => h2.share - h1.share);

    return {
      honeypotCount: metadata.honeypots.length,
      honeypotShortList: sortedHoneyPotList.slice(0, 15),
      honeypotTotalShare: metadata.honeypotTotalShare,
    };
  }
}

export default HoneyPotShareDominanceModule;
