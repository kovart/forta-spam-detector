import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { TokenStandard } from '../../types';
import { AIRDROP_MODULE_KEY } from './airdrop';

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
    const { token, context, transformer } = params;

    let detected = false;
    let metadata: SilentMintMetadata | undefined = undefined;

    context[SILENT_MINT_MODULE_KEY] = { detected, metadata };

    if (!context[AIRDROP_MODULE_KEY]?.detected) return;
    if (token.type !== TokenStandard.Erc20) return;

    const balanceByAccount = await transformer.balanceByAccount(token);

    const negativeBalanceAccounts: Account[] = [];
    for (const [address, balance] of balanceByAccount) {
      if (address === token.deployer || address === token.address) continue;
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
