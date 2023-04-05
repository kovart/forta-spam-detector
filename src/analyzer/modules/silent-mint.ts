import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';

import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { TokenStandard } from '../../types';

// The purpose of this module is to detect if a user has a negative balance.
// A negative balance is typically associated with fraudulent tokens,
// as it indicates that the user has somehow managed to spend more tokens than they possess.
// Furthermore, it may suggest an inadequately operating token contract that fails to emit Transfer events upon the mint of new tokens.
// Example: https://etherscan.io/token/0x7de45d86199a2e4f9d8bf45bfd4a578886b48d3c?a=0x85e8227c04970370ba129849459e3b46f8fd5923

export const SILENT_MINT_MODULE_KEY = 'SilentMint';

type Account = { address: string; balance: string };

export type SilentMintMetadata = {
  accounts: Account[];
};

export type SilentMintShortMetadata = {
  accountCount: number;
  accountShortList: Account[];
};

class SilentMintModule extends AnalyzerModule {
  static Key = SILENT_MINT_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, storage } = params;

    let detected = false;
    let metadata: SilentMintMetadata | undefined = undefined;

    context[SILENT_MINT_MODULE_KEY] = { detected, metadata };

    if (token.type !== TokenStandard.Erc20) return;

    const balanceByAccount = new Map<string, BigNumber>();

    for (const event of storage.erc20TransferEventsByToken.get(token.address) || []) {
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

    const negativeBalanceAccounts: Account[] = [];
    for (const [address, balance] of balanceByAccount) {
      if (balance.isNegative()) {
        negativeBalanceAccounts.push({ address, balance: balance.toString() });
      }
    }

    if (negativeBalanceAccounts.length > 0) {
      detected = true;
      metadata = {
        accounts: negativeBalanceAccounts,
      };
    }

    context[SILENT_MINT_MODULE_KEY] = { detected, metadata };
  }

  simplifyMetadata(metadata: SilentMintMetadata): SilentMintShortMetadata {
    return {
      accountCount: metadata.accounts.length,
      accountShortList: metadata.accounts.slice(0, 15),
    };
  }
}

export default SilentMintModule;
