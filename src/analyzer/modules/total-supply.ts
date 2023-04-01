import { ethers, BigNumber } from 'ethers';

import { erc721Iface } from '../../contants';
import { TokenStandard } from '../../types';
import { retry } from '../../utils/helpers';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const FALSE_TOTAL_SUPPLY_MODULE_KEY = 'Erc721FalseTotalSupply';

type Erc721FalseTotalSupplyModuleMetadata = {
  declaredTotalSupply: number;
  actualTotalSupply: number;
};

class Erc721FalseTotalSupplyModule extends AnalyzerModule {
  static Key = FALSE_TOTAL_SUPPLY_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, storage, provider } = params;

    let detected = false;
    let metadata: Erc721FalseTotalSupplyModuleMetadata | undefined = undefined;

    context[FALSE_TOTAL_SUPPLY_MODULE_KEY] = { detected, metadata };

    if (token.type !== TokenStandard.Erc721) return;

    const contract = new ethers.Contract(token.address, erc721Iface, provider);

    try {
      const totalSupply = ((await retry(() => contract.totalSupply())) as BigNumber).toNumber();

      const ownerByTokenId = new Map<string, string>();
      for (const event of storage.erc721TransferEventsByToken.get(token.address) || []) {
        ownerByTokenId.set(event.tokenId, event.to);
      }

      let actualTotalSupply = 0;
      for (const owner of ownerByTokenId.values()) {
        if (owner === ethers.constants.AddressZero) continue;
        actualTotalSupply++;
      }

      if (actualTotalSupply === totalSupply) return;

      detected = true;
      metadata = {
        declaredTotalSupply: totalSupply,
        actualTotalSupply: actualTotalSupply,
      };
    } catch {
      // not supported
      return;
    }

    context[FALSE_TOTAL_SUPPLY_MODULE_KEY] = { detected, metadata };
  }
}

export default Erc721FalseTotalSupplyModule;
