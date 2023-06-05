import { ethers } from 'ethers';
import { shuffle } from 'lodash';

import { SimplifiedTransaction, TokenEvent, TokenStandard } from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { isBurnAddress } from '../../utils/helpers';
import AirdropModule, { AirdropModuleMetadata } from './airdrop';

export const SLEEP_MINT_MODULE_KEY = 'SleepMint';
export const SLEEP_MINT_RECEIVERS_THRESHOLD = 4;

// Not a sleep mint
// https://bscscan.com/tx/0xc14f3e12f0ee9980c1087b785f723d0af2fdc47a98212dbdefa1bc8d08695bac

// TODO False positive
// https://ftmscan.com/tx/0xe8bd8ec593f5fea66cda541065e6ac65d3576b983b68cc9405639ff1d2e09f5d

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
    const { token, storage, context } = params;

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

    const sleepMintSet = new Set<SleepMintInfo>();
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

      sleepMintSet.add({
        from: event.from,
        to: event.to,
        sender: event.transaction.from,
        txHash: event.transaction.hash,
      });
    }

    const sleepMintReceiverSet = new Set([...sleepMintSet].map((m) => m.to));
    if (sleepMintReceiverSet.size > SLEEP_MINT_RECEIVERS_THRESHOLD) {
      detected = true;
      metadata = {
        sleepMints: [...sleepMintSet],
      };
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
