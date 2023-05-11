import { TokenStandard } from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

// Detect when single token in the ERC721 collection
// has been transferred to multiple owners indicating fraudulent transfers.
// Example: https://etherscan.io/nft/0x000386e3f7559d9b6a2f5c46b4ad1a9587d59dc3/2

export const MULTIPLE_OWNERS_MODULE_KEY = 'Erc721MultipleOwners';

export type Erc721MultipleOwnersModuleMetadata = {
  ownersByTokenId: { [tokenId: string]: string[] };
};

export type Erc721MultipleOwnersModuleShortMetadata = {
  duplicatedTokenCount: number;
  duplicatedTokenShortMap: { [tokenId: string]: string[] };
};

class Erc721MultipleOwnersModule extends AnalyzerModule {
  static Key = MULTIPLE_OWNERS_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, storage } = params;

    let detected = false;
    let metadata: Erc721MultipleOwnersModuleMetadata | undefined = undefined;

    if (token.type === TokenStandard.Erc721) {
      const transferEvents = await storage.getErc721TransferEvents(token.address);

      // tokenId -> account[]
      const ownersByTokenId = new Map<string, string[]>();

      for (const event of transferEvents) {
        const tokenId = event.tokenId.toString();
        let holders = ownersByTokenId.get(tokenId) || [];

        // Remove the previous owner, but only once
        const previousOwnerIndex = holders.indexOf(event.from);
        if (previousOwnerIndex > -1) {
          holders.splice(previousOwnerIndex, 1);
        }

        // add new owner
        holders.push(event.to);
        ownersByTokenId.set(tokenId, holders);
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

  simplifyMetadata(
    metadata: Erc721MultipleOwnersModuleMetadata,
  ): Erc721MultipleOwnersModuleShortMetadata {
    const duplicatedTokenShortMap: { [tokenId: string]: string[] } = {};
    Object.entries(metadata.ownersByTokenId)
      .slice(0, 15)
      .map(([tokenId, owners]) => {
        duplicatedTokenShortMap[tokenId] = owners.slice(0, 5);
      });

    return {
      duplicatedTokenCount: Object.keys(metadata.ownersByTokenId).length,
      duplicatedTokenShortMap: duplicatedTokenShortMap,
    };
  }
}

export default Erc721MultipleOwnersModule;
