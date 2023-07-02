import { ethers, BigNumber } from 'ethers';

import { erc721Iface } from '../../contants';
import { TokenStandard } from '../../types';
import { retry } from '../../utils/helpers';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { AIRDROP_MODULE_KEY } from './airdrop';

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

    if (!context[AIRDROP_MODULE_KEY]?.detected) return;

    const memo = memoizer.getScope(token.address);

    const isTotalSupplyImplemented = memo.get<boolean>('isTotalSupplyImplemented');

    if (token.type !== TokenStandard.Erc721) return;
    if (isTotalSupplyImplemented != null && !isTotalSupplyImplemented) return;

    const transferEvents = await storage.getErc721TransferEvents(token.address);

    const result = await memo(FALSE_TOTAL_SUPPLY_MODULE_KEY, [transferEvents.length], async () => {
      try {
        const contract = new ethers.Contract(token.address, erc721Iface, provider);

        const declaredTotalSupply = await retry(async () => {
          const totalSupply = (await contract.totalSupply({ blockTag: blockNumber })) as BigNumber;
          return totalSupply.toNumber();
        });

        memo.set('isTotalSupplyImplemented', true);

        const ownerByTokenId = new Map<string, string>();
        for (const event of transferEvents) {
          // ignore events of newer blocks
          if (event.transaction.blockNumber > blockNumber) continue;

          ownerByTokenId.set(event.tokenId.toString(), event.to);
        }

        let actualTotalSupply = 0;
        for (const owner of ownerByTokenId.values()) {
          if (owner === ethers.constants.AddressZero) continue;
          actualTotalSupply++;
        }

        metadata = {
          declaredTotalSupply: declaredTotalSupply,
          actualTotalSupply: actualTotalSupply,
        };

        // Sometimes, tokens can show total supply more than this bot was able to capture.
        // This can be due to missing some transactions or bad configuration of the token.
        // Therefore, to avoid FPs, we only detect an obvious lie when we find more tokens than the contract claims.

        detected = actualTotalSupply > declaredTotalSupply;
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
