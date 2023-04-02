import BigNumber from 'bignumber.js';

import HoneyPotChecker from '../../utils/honeypot';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const HONEY_POT_SHARE_MODULE_KEY = 'HoneypotShareDominance';
export const MIN_TOTAL_ACCOUNTS = 30;
export const DEVIATION_THRESHOLD = 0.15;
export const MIN_DOMINANT_ACCOUNTS = 12;
export const MAX_HONEYPOTS_DOMINANCE_RATE = 0.49;

type HoneypotShare = {
  address: string;
  share: number;
};

export type HoneyPotShareModuleMetadata = {
  honeypots: HoneypotShare[];
  honeypotTotalShare: number;
  honeypotDominanceRate: number;
};

export type HoneyPotShareModuleShortMetadata = {
  honeypotCount: number;
  honeypotShortList: HoneypotShare[];
  honeypotTotalShare: number;
  honeypotDominanceRate: number;
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

    // Use the cache, but clone it, since we will be modifying it
    const balanceByAccount = new Map(
      memo('balanceByAccount', [blockNumber], () => transformer.balanceByAccount(token)),
    );

    // Creators often allocate most of the tokens to themselves
    balanceByAccount.delete(token.deployer);
    balanceByAccount.delete(token.address);

    if (balanceByAccount.size < MIN_TOTAL_ACCOUNTS) return;

    const balances = [...balanceByAccount.values()];
    const totalBalance = this.sum(balances);

    const mean = this.sum(balances).div(balances.length);
    const variance = balances
      .reduce((acc, balance) => acc.plus(balance.minus(mean).pow(2)), new BigNumber(0))
      .div(balances.length);
    const stdDev = variance.sqrt();

    const isPreponderance = (balance: BigNumber) =>
      balance.isGreaterThan(stdDev.multipliedBy(DEVIATION_THRESHOLD).plus(mean));

    const dominantAccounts = [...balanceByAccount].filter(([, balance]) =>
      isPreponderance(balance),
    );

    if (dominantAccounts.length < MIN_DOMINANT_ACCOUNTS) return;

    const dominantHoneypots: [string, BigNumber][] = [];
    for (const [account, balance] of dominantAccounts) {
      const isHoneypot = await memo('honeypot', [account], () =>
        this.honeypotChecker.testAddress(account, provider, blockNumber),
      );
      if (isHoneypot) {
        dominantHoneypots.push([account, balance]);
      }
    }

    const dominanceRate = dominantHoneypots.length / dominantAccounts.length;

    detected = dominanceRate > MAX_HONEYPOTS_DOMINANCE_RATE;
    metadata = {
      honeypots: dominantHoneypots.map(([account, balance]) => ({
        address: account,
        share: new BigNumber(balance).div(totalBalance).toNumber(),
      })),
      honeypotTotalShare: this.sum(dominantHoneypots.map((h) => h[1]))
        .div(totalBalance)
        .toNumber(),
      honeypotDominanceRate: dominanceRate,
    };

    context[HONEY_POT_SHARE_MODULE_KEY] = { detected, metadata };
  }

  private sum(arr: (string | BigNumber)[]) {
    return arr.reduce((acc: BigNumber, curr) => acc.plus(curr), new BigNumber(0));
  }

  simplifyMetadata(metadata: HoneyPotShareModuleMetadata): HoneyPotShareModuleShortMetadata {
    return {
      honeypotCount: metadata.honeypots.length,
      honeypotShortList: metadata.honeypots.slice(0, 15),
      honeypotTotalShare: metadata.honeypotTotalShare,
      honeypotDominanceRate: metadata.honeypotDominanceRate,
    };
  }
}

export default HoneyPotShareDominanceModule;
