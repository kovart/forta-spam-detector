import { chunk } from 'lodash';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';

import {
  Erc1155TransferBatchEvent,
  Erc1155TransferSingleEvent,
  Erc20TransferEvent,
  Erc721TransferEvent,
  SimplifiedTransaction,
  TokenStandard,
} from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

dayjs.extend(duration);

export type AirdropModuleMetadata = {
  senders: string[];
  receivers: string[];
  txHashes: string[];
  airdropStartTime: number;
};

export const AIRDROP_MODULE_KEY = 'Airdrop';
export const AIRDROP_RECEIVERS_THRESHOLD = 49;
export const AIRDROP_TIME_WINDOW = dayjs.duration(4, 'day').asSeconds();

// Criteria:
// 1. The person receiving the mint didn't initiate (no claim action)
// 2. One sender with more than 49 unique receivers in a short interval of time (4 days)
// 3. Receivers are EOAs
// ----------
// Random airdrop:
// https://etherscan.io/tx/0xd9c8cad2c21c7f0e4d1745a68052cb92990ae9f63cd9b6b1cf9c9153c4d936c3
// Airdrop from sender's account:
// https://etherscan.io/tx/0x2f81572ec479b15cc82014551c2af76734d362d39ad5136aa2693956654002a7
// Airdrop with Sleep Mint:
// https://etherscan.io/tx/0x2226964e13a42cd7099d72349de8258c39c7014940d28a835f8d135cc14c7b51
// Airdrop via OpenSea:
// https://etherscan.io/tx/0xbac082a0683cbfd2e8efafc68f40fc9d5a525d9d591e7db879dcf50a5afebbd0

class AirdropModule extends AnalyzerModule {
  static Key = AIRDROP_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, storage, provider, context } = params;

    let detected = false;
    let metadata: AirdropModuleMetadata | undefined = undefined;

    const transfersBySender = new Map<
      string,
      Set<{ receiver: string; tx: SimplifiedTransaction }>
    >();

    let transferEvents: Set<
      | Erc20TransferEvent
      | Erc721TransferEvent
      | (Erc1155TransferSingleEvent | Erc1155TransferBatchEvent)
    > = new Set();

    if (token.type === TokenStandard.Erc20) {
      transferEvents = storage.erc20TransferEventsByToken.get(token.address) || new Set();
    } else if (token.type === TokenStandard.Erc721) {
      transferEvents = storage.erc721TransferEventsByToken.get(token.address) || new Set();
    } else if (token.type === TokenStandard.Erc1155) {
      transferEvents = storage.erc1155TransferSingleEventsByToken.get(token.address) || new Set();
      (storage.erc1155TransferBatchEventsByToken.get(token.address) || []).forEach((e) =>
        transferEvents.add(e),
      );
    }

    for (const transferEvent of transferEvents) {
      const sender = transferEvent.transaction.from;

      if (token.type === TokenStandard.Erc20) {
        // Zero transfer phishing?
        if ((transferEvent as Erc20TransferEvent).value === '0') continue;
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
      interval: [number, number];
    };

    // Detect senders with signs of an airdrop
    const airdropsBySender = new Map<string, AirdropData>();
    for (const [sender, transferSet] of transfersBySender) {
      const transfers = [...transferSet];

      for (let startIndex = 0; startIndex < transfers.length; startIndex++) {
        let detected = false;
        let interval: [number, number];
        const txHashSet = new Set<string>();
        const receiverSet = new Set<string>();

        for (let t = startIndex; t < transfers.length; t++) {
          const transfer = transfers[t];

          if (transfer.tx.timestamp - transfers[startIndex].tx.timestamp > AIRDROP_TIME_WINDOW)
            break;

          receiverSet.add(transfer.receiver);
          txHashSet.add(transfer.tx.hash);

          if (receiverSet.size > AIRDROP_RECEIVERS_THRESHOLD) {
            detected = true;
            interval = [transfers[startIndex].tx.timestamp, transfer.tx.timestamp];
            break;
          }
        }

        if (detected) {
          airdropsBySender.set(sender, {
            interval: interval!,
            receivers: [...receiverSet],
            txHashes: [...txHashSet],
          });
          // Go to next sender
          break;
        }
      }
    }

    // Check if receivers are EOAs
    for (const [sender, airdrop] of airdropsBySender) {
      const { receivers } = airdrop;
      const EOAs = [];

      for (const batch of chunk(receivers, 4)) {
        if (EOAs.length > AIRDROP_RECEIVERS_THRESHOLD) {
          // This is enough to confirm the airdrop
          break;
        }

        // Execute 4 queries in parallel.
        // If we use JsonRpcBatchProvider, this will help us complete the task faster
        const codes = await Promise.all(batch.map((r) => provider.getCode(r)));

        for (let i = 0; i < batch.length; i++) {
          if (codes[i] === '0x') EOAs.push(batch[i]);
        }
      }

      if (EOAs.length <= AIRDROP_RECEIVERS_THRESHOLD) {
        airdropsBySender.delete(sender);
      }
    }

    // Check if detected at least one airdrop
    if (airdropsBySender.size > 0) {
      detected = true;

      const receivers = new Set<string>();
      const txHashes = new Set<string>();

      // Pushing all receivers of all transfers from senders
      // noticed engaging in the airdrop campaign
      for (const sender of airdropsBySender.keys()) {
        transfersBySender.get(sender)!.forEach((t) => {
          receivers.add(t.receiver);
          txHashes.add(t.tx.hash);
        });
      }

      let airdropStartTime = Infinity;
      for (const airdrop of airdropsBySender.values()) {
        if (airdrop.interval[0] < airdropStartTime) {
          airdropStartTime = airdrop.interval[0];
        }
      }

      metadata = {
        receivers: [...receivers],
        senders: [...airdropsBySender.keys()],
        txHashes: [...txHashes],
        airdropStartTime: airdropStartTime,
      };
    }

    context[AIRDROP_MODULE_KEY] = { detected, metadata };

    return { interrupt: !detected };
  }
}

export default AirdropModule;
