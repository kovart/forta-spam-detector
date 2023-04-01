import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';

import { TokenStandard } from '../../types';
import HoneyPotChecker from '../../utils/honeypot';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const HONEY_POTS_SHARE_MODULE_KEY = 'HoneypotsShareDominance';
export const MIN_TOTAL_ACCOUNTS = 30;
export const DEVIATION_THRESHOLD = 0.15;
export const MIN_DOMINANT_ACCOUNTS = 12;
export const MAX_HONEYPOTS_DOMINANCE_RATE = 0.49;

type HoneypotShare = {
  address: string;
  share: number;
};

export type HoneyPotsShareModuleMetadata = {
  honeypots: HoneypotShare[];
  honeypotTotalShare: number;
  honeypotDominanceRate: number;
};

export type HoneyPotsShareModuleShortMetadata = {
  honeypotCount: number;
  honeypotShortList: HoneypotShare[];
  honeypotTotalShare: number;
  honeypotDominanceRate: number;
};

class HoneyPotsShareDominanceModule extends AnalyzerModule {
  static Key = HONEY_POTS_SHARE_MODULE_KEY;

  constructor(private honeypotChecker: HoneyPotChecker) {
    super();
  }

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, storage, memoizer, provider, blockNumber, context } = params;

    let detected = false;
    let metadata: HoneyPotsShareModuleMetadata | undefined = undefined;

    const memo = memoizer.getScope(token.address);

    context[HONEY_POTS_SHARE_MODULE_KEY] = { detected, metadata };

    const sum = (arr: (string | BigNumber)[]) =>
      arr.reduce((acc: BigNumber, curr) => acc.plus(curr), new BigNumber(0));

    const balanceByAccount = new Map<string, BigNumber>();

    if (token.type === TokenStandard.Erc20) {
      const transferEvents = storage.erc20TransferEventsByToken.get(token.address) || [];

      for (const event of transferEvents) {
        if (event.from !== ethers.constants.AddressZero) {
          let fromBalance = balanceByAccount.get(event.from) || new BigNumber(0);
          fromBalance = fromBalance.minus(event.value);
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(event.value);
          balanceByAccount.set(event.to, toBalance);
        }
      }
    } else if (token.type === TokenStandard.Erc721) {
      const transferEvents = storage.erc721TransferEventsByToken.get(token.address) || [];

      for (const event of transferEvents) {
        if (event.from !== ethers.constants.AddressZero) {
          let fromBalance = balanceByAccount.get(event.from) || new BigNumber(0);
          fromBalance = fromBalance.minus(1);
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(1);
          balanceByAccount.set(event.to, toBalance);
        }
      }
    } else if (token.type === TokenStandard.Erc1155) {
      const transferSingleEvents =
        storage.erc1155TransferSingleEventsByToken.get(token.address) || [];
      const transferBatchEvents =
        storage.erc1155TransferBatchEventsByToken.get(token.address) || [];

      for (const event of transferSingleEvents) {
        if (event.from !== ethers.constants.AddressZero) {
          let fromBalance = balanceByAccount.get(event.from) || new BigNumber(0);
          fromBalance = fromBalance.minus(event.value);
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(event.value);
          balanceByAccount.set(event.to, toBalance);
        }
      }

      for (const event of transferBatchEvents) {
        if (event.from !== ethers.constants.AddressZero) {
          let fromBalance = balanceByAccount.get(event.from) || new BigNumber(0);
          fromBalance = fromBalance.minus(sum(event.values));
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(sum(event.values));
          balanceByAccount.set(event.to, toBalance);
        }
      }
    }

    // Creators often allocate most of the tokens to themselves
    balanceByAccount.delete(token.deployer);
    balanceByAccount.delete(token.address);

    if (balanceByAccount.size < MIN_TOTAL_ACCOUNTS) return;

    const balances = [...balanceByAccount.values()];
    const totalBalance = sum(balances);

    const mean = sum(balances).div(balances.length);
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
      honeypotTotalShare: sum(dominantHoneypots.map((h) => h[1]))
        .div(totalBalance)
        .toNumber(),
      honeypotDominanceRate: dominanceRate,
    };

    context[HONEY_POTS_SHARE_MODULE_KEY] = { detected, metadata };
  }

  simplifyMetadata(metadata: HoneyPotsShareModuleMetadata): HoneyPotsShareModuleShortMetadata {
    return {
      honeypotCount: metadata.honeypots.length,
      honeypotShortList: metadata.honeypots.slice(15),
      honeypotTotalShare: metadata.honeypotTotalShare,
      honeypotDominanceRate: metadata.honeypotDominanceRate,
    };
  }
}

export default HoneyPotsShareDominanceModule;
