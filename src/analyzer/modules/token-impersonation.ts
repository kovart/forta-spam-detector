import { ethers } from 'ethers';

import TokenProvider, { TokenRecord } from '../../utils/tokens';
import { TokenStandard } from '../../types';
import { erc20Iface } from '../../contants';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const TOKEN_IMPERSONATION_MODULE_KEY = 'TokenImpersonation';

export type TokenImpersonationModuleMetadata = {
  name: string;
  symbol: string;
  type: TokenStandard;
  impersonatedToken?: TokenRecord;
};

class TokenImpersonationModule extends AnalyzerModule {
  static Key = TOKEN_IMPERSONATION_MODULE_KEY;

  constructor(private tokenProvider: TokenProvider) {
    super();
  }

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, provider, memoizer } = params;

    let detected = false;
    let metadata: TokenImpersonationModuleMetadata | undefined = undefined;

    context[TOKEN_IMPERSONATION_MODULE_KEY] = { detected, metadata };

    const memo = memoizer.getScope(token.address);

    let symbol: string | undefined;
    let name: string | undefined;

    try {
      const contract = new ethers.Contract(token.address, erc20Iface, provider);
      symbol = await memo('symbol', () => contract.symbol());
      name = await memo('name', () => contract.name());
    } catch {
      // not implemented metadata
    }

    if (!symbol || !name) return;

    try {
      const tokens = await this.tokenProvider.getList();
      const tokensByHash = new Map(tokens.map((t) => [this.tokenProvider.getTokenHash(t), t]));
      const existingToken = tokensByHash.get(this.tokenProvider.getTokenHash({ name, symbol }));

      detected = !!existingToken;
      metadata = {
        symbol,
        name,
        type: token.type,
      };

      if (detected) {
        metadata.impersonatedToken = existingToken;
      }
    } catch (e) {
      console.error(e);
    }

    context[TOKEN_IMPERSONATION_MODULE_KEY] = { detected, metadata };
  }
}

export default TokenImpersonationModule;
