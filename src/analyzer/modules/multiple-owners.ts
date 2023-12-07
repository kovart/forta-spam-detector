import { ethers } from 'ethers';
import { max, sortBy } from 'lodash';
import { DetailedErc721TransferEvent, TokenStandard } from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { erc721Iface } from '../../contants';
import Logger from '../../utils/logger';
import { retry } from '../../utils/helpers';
import { AIRDROP_MODULE_KEY } from './airdrop';
import { TOKEN_IMPERSONATION_MODULE_KEY } from './token-impersonation';

// Detect when single token in the ERC721 collection
// has been transferred to multiple owners indicating fraudulent transfers.
// Example: https://etherscan.io/nft/0x000386e3f7559d9b6a2f5c46b4ad1a9587d59dc3/2

export const MULTIPLE_OWNERS_MODULE_KEY = 'Erc721MultipleOwners';
export const MIN_DUPLICATED_TOKENS = 10;
export const MIN_DUPLICATED_TOKENS_FROM_SAME_SENDER = 5;
export const DUPLICATION_LIMIT = 200; // optimization

export type DuplicatedTransferEvent = {
  from: string;
  to: string;
  txHash: string;
};

export type Erc721MultipleOwnersModuleMetadata = {
  duplicatedTransfersByTokenId: { [tokenId: string]: DuplicatedTransferEvent[] };
};

export type Erc721MultipleOwnersModuleShortMetadata = {
  duplicatedTokenCount: number;
  duplicatedTransferCount: number;
  duplicatedTransferShortMap: { [tokenId: string]: DuplicatedTransferEvent[] };
};

// This module has been designed to allow situations in which the bot may have dropped transactions

class Erc721MultipleOwnersModule extends AnalyzerModule {
  static Key = MULTIPLE_OWNERS_MODULE_KEY;

  private minDuplicatedTokens: number;
  private minDuplicatedTokensFromSameSender: number;

  constructor(config?: {
    minDuplicatedTokens?: number;
    minDuplicatedTokensFromSameSender?: number;
  }) {
    super();

    this.minDuplicatedTokens = config?.minDuplicatedTokens || MIN_DUPLICATED_TOKENS;
    this.minDuplicatedTokensFromSameSender =
      config?.minDuplicatedTokensFromSameSender || MIN_DUPLICATED_TOKENS_FROM_SAME_SENDER;
  }

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, blockNumber, storage, provider } = params;

    let detected = false;
    let metadata: Erc721MultipleOwnersModuleMetadata | undefined = undefined;

    context[MULTIPLE_OWNERS_MODULE_KEY] = { detected, metadata };

    if (![AIRDROP_MODULE_KEY, TOKEN_IMPERSONATION_MODULE_KEY].some((key) => context[key]?.detected))
      return;

    if (token.type !== TokenStandard.Erc721) return;

    const duplicationsByTokenId = new Map<string, DuplicatedTransferEvent[]>();

    const transferEvents = (await storage.getErc721TransferEvents(token.address)).filter(
      (e) => e.transaction.blockNumber <= blockNumber,
    );
    const eventsByBlock = this.groupBy(transferEvents, (e) => e.transaction.blockNumber);
    const blockNumbers = Array.from(eventsByBlock.keys());
    blockNumbers.sort((b1, b2) => b1 - b2);

    const append = <T, P>(map: Map<T, P[]>, key: T, value: P) => {
      let arr = map.get(key);
      if (!arr) {
        arr = [];
      }
      arr.push(value);
      map.set(key, arr);
    };

    const maxErrorCount = 10;
    let errorCounter = 0;

    // tokenId -> transfers[]
    const allTransfersByTokenId = new Map<string, DetailedErc721TransferEvent[]>();
    for (const blockNumber of blockNumbers) {
      const transferSet = eventsByBlock.get(blockNumber) || new Set();
      const transfersByTokenId = this.groupBy(transferSet, (e) => e.tokenId.toString());

      for (const [tokenId, tokenTransfers] of transfersByTokenId) {
        // Sort by multiple fields; first transaction index then log index
        const sortedTransfers = sortBy(
          [...tokenTransfers],
          [(t) => t.transaction.index, (t) => t.logIndex],
        );

        for (let i = 0; i < sortedTransfers.length; i++) {
          const allTokenTransfers = allTransfersByTokenId.get(tokenId);
          const currTokenTransfer = sortedTransfers[i];
          const prevTokenTransfer = allTokenTransfers
            ? allTokenTransfers[allTokenTransfers.length - 1]
            : null;

          if (prevTokenTransfer) {
            if (
              prevTokenTransfer.to !== currTokenTransfer.from &&
              // ensure there are no anomalies in db
              !(
                prevTokenTransfer.transaction.hash == currTokenTransfer.transaction.hash &&
                prevTokenTransfer.logIndex == currTokenTransfer.logIndex
              )
            ) {
              // Detected an anomaly; multiple owners of the same token id

              const isFirstTransferInBlock = i === 0;
              if (isFirstTransferInBlock) {
                try {
                  // Check with blockchain data
                  const contract = new ethers.Contract(token.address, erc721Iface, provider);
                  const prevBlockchainOwner = (
                    await retry<string>(
                      () =>
                        contract.ownerOf(tokenId, {
                          blockTag: blockNumber - 1,
                        }),
                      { wait: 3 * 1000, attempts: 3 },
                    )
                  ).toLowerCase();

                  const currentBlockchainOwner = (
                    await retry<string>(
                      () =>
                        contract.ownerOf(tokenId, {
                          blockTag: blockNumber,
                        }),
                      { wait: 3 * 1000, attempts: 3 },
                    )
                  ).toLowerCase();

                  if (
                    prevBlockchainOwner !== currTokenTransfer.from ||
                    currentBlockchainOwner !== currTokenTransfer.to
                  ) {
                    // We've confirmed detection with blockchain data

                    append(duplicationsByTokenId, tokenId, {
                      txHash: currTokenTransfer.transaction.hash,
                      from: currTokenTransfer.from,
                      to: currTokenTransfer.to,
                    });
                  }
                } catch (e: any) {
                  Logger.error(e);
                  errorCounter++;
                  break;
                }
              } else {
                append(duplicationsByTokenId, tokenId, {
                  txHash: currTokenTransfer.transaction.hash,
                  from: currTokenTransfer.from,
                  to: currTokenTransfer.to,
                });
              }
            }
          }

          append(allTransfersByTokenId, tokenId, currTokenTransfer);
        }

        if (errorCounter >= maxErrorCount) {
          break;
        }
      }

      // Too many duplications
      if (duplicationsByTokenId.size >= DUPLICATION_LIMIT) {
        break;
      }

      // Too many errors
      if (errorCounter >= maxErrorCount) {
        break;
      }
    }

    const duplicatedTokenIdsBySender = new Map<string, number>();
    for (const [tokenId, transfers] of duplicationsByTokenId) {
      for (const transfer of transfers) {
        const duplicatedTokens = duplicatedTokenIdsBySender.get(transfer.from) || 0;
        duplicatedTokenIdsBySender.set(transfer.from, duplicatedTokens + 1);
      }
    }

    const maxDuplicationPerSender: number = max([...duplicatedTokenIdsBySender.values()]) ?? 0;

    if (
      maxDuplicationPerSender >= this.minDuplicatedTokensFromSameSender ||
      duplicationsByTokenId.size >= this.minDuplicatedTokens
    ) {
      detected = true;

      const map: { [tokenId: string]: DuplicatedTransferEvent[] } = {};
      for (const [tokenId, transfers] of duplicationsByTokenId) {
        map[tokenId] = transfers;
      }

      metadata = {
        duplicatedTransfersByTokenId: map,
      };
    }

    context[MULTIPLE_OWNERS_MODULE_KEY] = { detected, metadata };
  }

  groupBy<T, K>(array: T[] | Set<T>, groupingFunction: (item: T) => K): Map<K, Set<T>> {
    const map = new Map<K, Set<T>>();

    for (const item of array) {
      const key = groupingFunction(item);
      const set = map.get(key);

      if (set) {
        set.add(item);
      } else {
        const set = new Set<T>();
        set.add(item);
        map.set(key, set);
      }
    }

    return map;
  }

  // Example usage remains the same

  simplifyMetadata(
    metadata: Erc721MultipleOwnersModuleMetadata,
  ): Erc721MultipleOwnersModuleShortMetadata {
    const duplicatedTransferShortMap: { [tokenId: string]: DuplicatedTransferEvent[] } = {};
    Object.entries(metadata.duplicatedTransfersByTokenId)
      .slice(0, 15)
      .map(([tokenId, transfers]) => {
        duplicatedTransferShortMap[tokenId] = transfers.slice(0, 5);
      });

    return {
      duplicatedTokenCount: Object.keys(metadata.duplicatedTransfersByTokenId).length,
      duplicatedTransferCount: Object.values(metadata.duplicatedTransfersByTokenId).flat().length,
      duplicatedTransferShortMap: duplicatedTransferShortMap,
    };
  }
}

export default Erc721MultipleOwnersModule;
