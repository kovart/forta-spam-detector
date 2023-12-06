import { chunk } from 'lodash';

import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import {
  DetailedErc1155TransferBatchEvent,
  DetailedErc1155TransferSingleEvent,
  DetailedErc20TransferEvent,
  DetailedErc721TransferEvent,
  SimplifiedTransaction,
  TokenStandard,
} from '../../types';
import { PROVIDER_CONCURRENCY } from '../../contants';
import Logger from '../../utils/logger';

// This module detects airdrops by the following criteria:
// 1. The person receiving the mint didn't initiate (no claim action)
// 2. One sender with at least 50 unique receivers in a short interval of time (5 days)
// 3. Or, one tx with a sender to at least 15 unique receivers
// 4. Receivers are EOAs
// ----------
// Random airdrop:
// https://etherscan.io/tx/0xd9c8cad2c21c7f0e4d1745a68052cb92990ae9f63cd9b6b1cf9c9153c4d936c3
// Airdrop from sender's account:
// https://etherscan.io/tx/0x2f81572ec479b15cc82014551c2af76734d362d39ad5136aa2693956654002a7
// Airdrop with Sleep Mint:
// https://etherscan.io/tx/0x2226964e13a42cd7099d72349de8258c39c7014940d28a835f8d135cc14c7b51
// Airdrop via OpenSea:
// https://etherscan.io/tx/0xbac082a0683cbfd2e8efafc68f40fc9d5a525d9d591e7db879dcf50a5afebbd0

export type AirdropTransfer = {
  timestamp: number;
  receiver: string;
};

export type AirdropModuleMetadata = {
  senders: string[];
  receivers: string[];
  txHashes: string[];
  transfers: AirdropTransfer[];
  startTime: number;
  endTime: number;
};

export type AirdropModuleShortMetadata = {
  senderCount: number;
  senderShortList: string[];
  receiverCount: number;
  receiverShortList: string[];
  transactionCount: number;
  transactionShortList: string[];
  startTime: number;
  endTime: number;
};

export const AIRDROP_MODULE_KEY = 'Airdrop';
export const MIN_RECEIVERS_PER_TX = 9;
export const MIN_RECEIVERS_PER_SENDER = 20;
export const AIRDROP_WINDOW = 5 * 24 * 60 * 60; // 5d
export const MAX_RECEIVERS_PER_AIRDROP = 10_000; // break loop if more

class AirdropModule extends AnalyzerModule {
  static Key = AIRDROP_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, storage, provider, memoizer, context } = params;

    let detected = false;
    let metadata: AirdropModuleMetadata | undefined = undefined;

    const memo = memoizer.getScope(token.address);

    let transferEvents: Set<
      | DetailedErc20TransferEvent
      | DetailedErc721TransferEvent
      | (DetailedErc1155TransferSingleEvent | DetailedErc1155TransferBatchEvent)
    > = new Set();

    const setify = <T>(arr: T[]): Set<T> => (arr == null ? new Set() : new Set(arr));

    if (token.type === TokenStandard.Erc20) {
      transferEvents = setify(await storage.getErc20TransferEvents(token.address));
    } else if (token.type === TokenStandard.Erc721) {
      transferEvents = setify(await storage.getErc721TransferEvents(token.address));
    } else if (token.type === TokenStandard.Erc1155) {
      transferEvents = setify(await storage.getErc1155TransferSingleEvents(token.address));
      (await storage.getErc1155TransferBatchEvents(token.address)).forEach((e) =>
        transferEvents.add(e),
      );
    }

    // If we have exactly the same number of events, then we don't need to perform this again
    const result = await memo(AIRDROP_MODULE_KEY, [transferEvents.size], async () => {
      const transfersBySender = new Map<
        string,
        Set<{ receiver: string; tx: SimplifiedTransaction }>
      >();

      let p0 = performance.now();

      for (const transferEvent of transferEvents) {
        const sender = transferEvent.transaction.from;

        if (token.type === TokenStandard.Erc20) {
          // Zero transfer phishing?
          if ((transferEvent as DetailedErc20TransferEvent).value.toString() === '0') continue;
        }

        // Claim or exchange action?
        if (sender == transferEvent.to) continue;

        let transferSet = transfersBySender.get(sender);
        if (!transferSet) {
          transferSet = new Set();
          transfersBySender.set(sender, transferSet);
        }
        transferSet.add({
          receiver: transferEvent.to,
          tx: transferEvent.transaction,
        });
      }

      type AirdropData = {
        receivers: string[];
        txHashes: string[];
        startTime: number;
        endTime: number;
      };

      // Detect senders with signs of an airdrop
      const airdropBySender = new Map<string, AirdropData>();
      const airdropTransferSet = new Set<AirdropTransfer>();
      for (const [sender, transferSet] of transfersBySender) {
        let isAirdropDetected = false;
        let airdropStartTime: number | undefined;
        let airdropEndTime: number | undefined;

        const txHashSet = new Set<string>();
        const receiverSet = new Set<string>();

        // Detect airdrops with multiple receivers in one tx
        const receiversByTx = new Map<SimplifiedTransaction, Set<string>>();
        for (const transfer of transferSet) {
          let set = receiversByTx.get(transfer.tx);
          if (!set) {
            set = new Set();
            receiversByTx.set(transfer.tx, set);
          }
          set.add(transfer.receiver);
        }

        for (const [tx, receivers] of receiversByTx) {
          if (receivers.size >= MIN_RECEIVERS_PER_TX) {
            isAirdropDetected = true;
            airdropStartTime = Math.min(airdropStartTime ?? tx.timestamp, tx.timestamp);
            airdropEndTime = Math.max(airdropEndTime ?? tx.timestamp, tx.timestamp);
            txHashSet.add(tx.hash);
            receivers.forEach((r) => {
              airdropTransferSet.add({
                receiver: r,
                timestamp: tx.timestamp,
              });
              receiverSet.add(r);
            });
          }
        }

        // Do not check with another approach if airdrop is already detected.
        if (!isAirdropDetected) {
          // Detect airdrops with a window interval
          const transfers = [...transferSet];
          for (let startIndex = 0; startIndex < transfers.length; startIndex++) {
            const startTransfer = transfers[startIndex];

            receiverSet.clear();
            txHashSet.clear();

            let endIndex = startIndex;
            for (let t = startIndex; t < transfers.length; t++) {
              let endTransfer = transfers[t];
              airdropEndTime = endTransfer.tx.timestamp;

              // Break if the window time is over,
              // but continue if airdrop is already detected
              if (
                !isAirdropDetected &&
                endTransfer.tx.timestamp - startTransfer.tx.timestamp > AIRDROP_WINDOW
              ) {
                break;
              }

              isAirdropDetected = receiverSet.size > MIN_RECEIVERS_PER_SENDER;

              receiverSet.add(endTransfer.receiver);
              txHashSet.add(endTransfer.tx.hash);

              endIndex = t;

              if (receiverSet.size > MAX_RECEIVERS_PER_AIRDROP) {
                // enough to confirm airdrop
                break;
              }
            }

            if (isAirdropDetected) {
              airdropStartTime = startTransfer.tx.timestamp;
              for (let i = startIndex; i <= endIndex; i++) {
                const transfer = transfers[i];
                airdropTransferSet.add({
                  timestamp: transfer.tx.timestamp,
                  receiver: transfer.receiver,
                });
              }
              break;
            }
          }
        }

        if (isAirdropDetected) {
          airdropBySender.set(sender, {
            startTime: airdropStartTime!,
            endTime: airdropEndTime!,
            receivers: [...receiverSet],
            txHashes: [...txHashSet],
          });
        }
      }

      // Check if receivers are EOAs
      for (const [sender, airdrop] of airdropBySender) {
        const { receivers } = airdrop;
        const EOAs = [];

        for (const batch of chunk(receivers, PROVIDER_CONCURRENCY)) {
          if (EOAs.length > MIN_RECEIVERS_PER_SENDER) {
            // This is enough to confirm the airdrop
            break;
          }

          // Execute queries in parallel.
          // If we use JsonRpcBatchProvider, this will help us complete the task faster
          const codes = await Promise.all(
            batch.map((receiver) => memo('getCode', [receiver], () => provider.getCode(receiver))),
          );

          for (let i = 0; i < batch.length; i++) {
            if (codes[i] === '0x') EOAs.push(batch[i]);
          }
        }

        if (EOAs.length <= MIN_RECEIVERS_PER_SENDER) {
          airdropBySender.delete(sender);
        }
      }

      // Check if detected at least one airdrop
      if (airdropBySender.size > 0) {
        detected = true;

        const receiverSet = new Set<string>();
        const txHashSet = new Set<string>();

        // Pushing all receivers of all transfers from senders
        // noticed engaging in the airdrop campaign
        for (const sender of airdropBySender.keys()) {
          transfersBySender.get(sender)!.forEach((t) => {
            receiverSet.add(t.receiver);
            txHashSet.add(t.tx.hash);
          });
        }

        let airdropStartTime: number | undefined;
        let airdropEndTime: number | undefined;
        for (const airdrop of airdropBySender.values()) {
          airdropStartTime = Math.min(airdropStartTime ?? airdrop.startTime, airdrop.startTime);
          airdropEndTime = Math.max(airdropEndTime ?? airdrop.endTime, airdrop.endTime);
        }

        metadata = {
          transfers: [...airdropTransferSet],
          receivers: [...receiverSet],
          senders: [...airdropBySender.keys()],
          txHashes: [...txHashSet],
          startTime: airdropStartTime!,
          endTime: airdropEndTime!,
        };
      }

      return { detected, metadata };
    });

    detected = result.detected;
    metadata = result.metadata;

    context[AIRDROP_MODULE_KEY] = { detected, metadata };

    return { interrupt: !detected };
  }

  simplifyMetadata(metadata: AirdropModuleMetadata): AirdropModuleShortMetadata {
    return {
      senderCount: metadata.senders.length,
      senderShortList: metadata.senders.slice(0, 15),
      receiverCount: metadata.receivers.length,
      receiverShortList: metadata.receivers.slice(0, 15),
      transactionCount: metadata.txHashes.length,
      transactionShortList: metadata.txHashes.slice(0, 15),
      startTime: metadata.startTime,
      endTime: metadata.endTime,
    };
  }
}

export default AirdropModule;
