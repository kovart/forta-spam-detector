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
    const { token, context, storage, memoizer, blockNumber, provider } = params;

    let detected = false;
    let metadata: Erc721FalseTotalSupplyModuleMetadata | undefined = undefined;

    context[FALSE_TOTAL_SUPPLY_MODULE_KEY] = { detected, metadata };

    const memo = memoizer.getScope(token.address);

    const isTotalSupplyImplemented = memo.get<boolean>('isTotalSupplyImplemented');

    if (token.type !== TokenStandard.Erc721) return;
    if (isTotalSupplyImplemented != null && !isTotalSupplyImplemented) return;

    const transferEvents = storage.erc721TransferEventsByToken.get(token.address) || new Set();

    const result = await memo(FALSE_TOTAL_SUPPLY_MODULE_KEY, [transferEvents.size], async () => {
      try {
        const contract = new ethers.Contract(token.address, erc721Iface, provider);

        const totalSupply = await retry(async () => {
          const totalSupply = (await contract.totalSupply({ blockTag: blockNumber })) as BigNumber;
          return totalSupply.toNumber();
        });

        memo.set('isTotalSupplyImplemented', true);

        const ownerByTokenId = new Map<string, string>();
        for (const event of transferEvents) {
          ownerByTokenId.set(event.tokenId.toString(), event.to);
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
        memo.set('isTotalSupplyImplemented', false);
        return;
      }

      return { detected, metadata };
    });

    if (result) {
      detected = result.detected;
      metadata = result.metadata;
    }

    context[FALSE_TOTAL_SUPPLY_MODULE_KEY] = { detected, metadata };
  }
}

export default Erc721FalseTotalSupplyModule;
