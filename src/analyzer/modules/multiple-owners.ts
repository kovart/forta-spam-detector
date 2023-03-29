import { TokenStandard } from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

// Detect when single token in the ERC721 collection
// has been transferred to multiple owners indicating fraudulent transfers.
// Example: https://etherscan.io/nft/0x000386e3f7559d9b6a2f5c46b4ad1a9587d59dc3/2

export const MULTIPLE_OWNERS_MODULE_KEY = 'Erc721MultipleOwners';

export type Erc721MultipleOwnersModuleMetadata = {
  ownersByTokenId: { [tokenId: string]: string[] };
};

class Erc721MultipleOwnersModule extends AnalyzerModule {
  static Key = MULTIPLE_OWNERS_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, storage } = params;

    let detected = false;
    let metadata: Erc721MultipleOwnersModuleMetadata | undefined = undefined;

    if (token.type === TokenStandard.Erc721) {
      const transferEvents = storage.erc721TransferEventsByToken.get(token.address) || [];

      // tokenId -> account[]
      const ownersByTokenId = new Map<string, string[]>();

      for (const event of transferEvents) {
        let holders = ownersByTokenId.get(event.tokenId) || [];
        ownersByTokenId.set(event.tokenId, holders);

        // Remove the previous owner, but only once
        const previousOwnerIndex = holders.indexOf(event.from);
        if (previousOwnerIndex > -1) {
          holders = holders.splice(previousOwnerIndex, 1);
        }
        // add new owner
        holders.push(event.to);
      }

      const duplicatedOwnersByTokenId: { [tokenId: string]: string[] } = {};
      for (const [tokenId, owners] of ownersByTokenId) {
        if (owners.length > 1) {
          detected = true;
          duplicatedOwnersByTokenId[tokenId] = owners;
        }
      }

      if (detected) {
        metadata = { ownersByTokenId: duplicatedOwnersByTokenId };
      }
    }

    context[MULTIPLE_OWNERS_MODULE_KEY] = { detected, metadata };
  }
}

export default Erc721MultipleOwnersModule;
