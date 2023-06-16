import { ethers } from 'ethers';
import { groupBy, shuffle } from 'lodash';

import { SimplifiedTransaction, TokenEvent, TokenStandard } from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { isBurnAddress } from '../../utils/helpers';
import AirdropModule, { AirdropModuleMetadata } from './airdrop';

export const SLEEP_MINT_MODULE_KEY = 'SleepMint';
export const SLEEP_MINT_RECEIVERS_THRESHOLD = 3;

type SleepMintInfo = {
  from: string;
  to: string;
  sender: string;
  txHash: string;
};

export type SleepMintModuleMetadata = {
  sleepMints: SleepMintInfo[];
};

export type SleepMintModuleShortMetadata = {
  sleepMintCount: number;
  sleepMintShortList: SleepMintInfo[];
  sleepMintReceiverCount: number;
  sleepMintReceiverShortList: string[];
  sleepMintTxCount: number;
  sleepMintTxShortList: string[];
};

class SleepMintModule extends AnalyzerModule {
  static Key = SLEEP_MINT_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, storage, context, provider } = params;

    let detected = false;
    let metadata: SleepMintModuleMetadata | undefined = undefined;

    const airdropMetadata = context[AirdropModule.Key].metadata as AirdropModuleMetadata;
    const airdropTxHashes = airdropMetadata.txHashes;

    // Map owner -> spenders
    // A bit of a simplified structure, with no knowledge of a particular token or values.
    // However, in theory this is not important in this context.
    const directApprovals = new Map<string, Set<string>>();
    const passiveApprovals = new Map<string, Set<string>>();

    // Normalize events so that we can apply common handlers for them
    const allApprovalEvents: (TokenEvent & { owner: string; spender: string })[] = [];

    if (token.type === TokenStandard.Erc20) {
      allApprovalEvents.push(...(await storage.getErc20ApprovalEvents(token.address)));
    } else if (token.type === TokenStandard.Erc721) {
      const approvalEvents = await storage.getErc721ApprovalEvents(token.address);
      const approvalForAllEvents = await storage.getErc721ApprovalForAllEvents(token.address);

      approvalEvents.forEach((e) => allApprovalEvents.push({ ...e, spender: e.approved }));
      approvalForAllEvents.forEach((e) => allApprovalEvents.push({ ...e, spender: e.operator }));
    } else if (token.type === TokenStandard.Erc1155) {
      const approvalForAllEvents = await storage.getErc1155ApprovalForAllEvents(token.address);
      approvalForAllEvents.forEach((e) => allApprovalEvents.push({ ...e, spender: e.operator }));
    }

    for (const event of allApprovalEvents) {
      if (event.transaction.from !== event.owner) {
        const set = passiveApprovals.get(event.owner) || new Set();
        passiveApprovals.set(event.owner, set);
        set.add(event.spender);
      } else if (event.transaction.from === event.owner) {
        const set = directApprovals.get(event.owner) || new Set();
        directApprovals.set(event.owner, set);
        set.add(event.spender);
      }
    }

    const sleepMints: SleepMintInfo[] = [];
    const airdropTxHashSet = new Set(airdropTxHashes);

    let transferEvents: { from: string; to: string; transaction: SimplifiedTransaction }[] = [];

    if (token.type === TokenStandard.Erc20) {
      transferEvents = await storage.getErc20TransferEvents(token.address);
    } else if (token.type === TokenStandard.Erc721) {
      transferEvents = await storage.getErc721TransferEvents(token.address);
    } else if (token.type === TokenStandard.Erc1155) {
      transferEvents = await storage.getErc1155TransferSingleEvents(token.address);
      for (const event of await storage.getErc1155TransferBatchEvents(token.address)) {
        transferEvents.push(event);
      }
    }

    for (const event of transferEvents) {
      if (
        event.from === ethers.constants.AddressZero ||
        event.transaction.from === event.from ||
        event.transaction.from === event.to ||
        event.from === token.address ||
        isBurnAddress(event.to) ||
        !airdropTxHashSet.has(event.transaction.hash)
      ) {
        continue;
      }

      // Skip if transaction is legal
      if (directApprovals.get(event.from)?.has(event.transaction.from)) continue;
      // When a contract has transferred some tokens to itself in order to transfer tokens from its account (Disperse.app)
      // E.g. https://etherscan.io/tx/0x20cd3045105ffff40ce4978f9daf460030257b5cff1587edd2bbe987fd850da1
      if (directApprovals.get(event.from)?.has(event.transaction.to!)) continue;

      sleepMints.push({
        from: event.from,
        to: event.to,
        sender: event.transaction.from,
        txHash: event.transaction.hash,
      });
    }

    const sleepMintReceiverSet = new Set(sleepMints.map((m) => m.to));

    if (sleepMintReceiverSet.size > SLEEP_MINT_RECEIVERS_THRESHOLD) {
      if (token.type === TokenStandard.Erc20) {
        // This token standard has more complex use cases with various token aggregators,
        // which can lead to possible false positives. An example of a token transfer without approves:
        // https://etherscan.io/tx/0x019a04b206c6257c8629986a5255ff4503be81a0759fa8798874a7ddf77e964c

        // To avoid false positives, we check for multiple approvals in the same transaction from the same owner.
        // You can see this pattern here:
        // https://polygonscan.com/tx/0x4f9170e145821e31c258c7d186d510728a16cfbd13d0bd53f59214aa7c3a7e3f

        const massSleepMints: SleepMintInfo[] = [];
        const mintsByTxHash = groupBy(sleepMints, (e) => e.txHash);

        for (const [txHash, txMints] of Object.entries(mintsByTxHash)) {
          const mintsByOwner = groupBy(txMints, (m) => m.from);

          for (const [owner, mints] of Object.entries(mintsByOwner)) {
            const receiverSet = new Set(mints.map((m) => m.to));
            if (receiverSet.size > SLEEP_MINT_RECEIVERS_THRESHOLD) {
              massSleepMints.push(...txMints);
              break;
            }
          }
        }

        if (massSleepMints.length > 0) {
          detected = true;
          metadata = { sleepMints: massSleepMints };
        }
      } else {
        detected = true;
        metadata = { sleepMints };
      }
    }

    context[SLEEP_MINT_MODULE_KEY] = { detected, metadata };
  }

  simplifyMetadata(metadata: SleepMintModuleMetadata): SleepMintModuleShortMetadata {
    const sleepMintTxs = [...new Set(metadata.sleepMints.map((m) => m.txHash))];
    const receivers = [...new Set(metadata.sleepMints.map((m) => m.to))];

    return {
      sleepMintCount: metadata.sleepMints.length,
      sleepMintShortList: shuffle(metadata.sleepMints).slice(0, 15),
      sleepMintTxCount: sleepMintTxs.length,
      sleepMintTxShortList: shuffle(sleepMintTxs).slice(0, 15),
      sleepMintReceiverCount: receivers.length,
      sleepMintReceiverShortList: receivers.slice(0, 15),
    };
  }
}

export default SleepMintModule;
