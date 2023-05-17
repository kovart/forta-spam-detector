import { ethers } from 'ethers';

import TokenProvider, { TokenRecord } from '../../utils/tokens';
import { TokenStandard } from '../../types';
import { erc20Iface } from '../../contants';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { normalizeName, normalizeText } from '../../utils/normalizer';

export const TOKEN_IMPERSONATION_MODULE_KEY = 'TokenImpersonation';

export type TokenImpersonationModuleMetadata = {
  name: string | undefined;
  symbol: string | undefined;
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

    metadata = {
      symbol,
      name,
      type: token.type,
    };

    if (symbol && name) {
      try {
        const tokens = await this.tokenProvider.getList();

        const tokensByHash = new Map<string, TokenRecord[]>();
        for (const token of tokens) {
          const hash = this.getTokenHash(token);
          let arr = tokensByHash.get(hash);
          if (!arr) {
            arr = [];
            tokensByHash.set(hash, arr);
          }
          arr.push(token);
        }

        const similarTokens = tokensByHash.get(this.getTokenHash({ name, symbol })) || [];

        // If the same token exists and its address does not match the current token.
        detected =
          similarTokens.length > 0 &&
          !similarTokens.find((t) =>
            Object.entries(t.deployments).find((e) => e[1].toLowerCase() == token.address),
          );

        if (detected) {
          metadata.impersonatedToken = similarTokens[0];
        }
      } catch (e) {
        console.error(e);
      }
    }

    context[TOKEN_IMPERSONATION_MODULE_KEY] = { detected, metadata };
  }

  getTokenHash(t: { name: string; symbol: string }) {
    return `${normalizeName(t.name || '')} (${normalizeText((t.symbol || '').toLowerCase())})`;
  }
}

export default TokenImpersonationModule;
