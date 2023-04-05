import { ethers } from 'ethers';
import { shuffle } from 'lodash';
import { queue } from 'async';

import { SimplifiedTransaction, TokenEvent, TokenStandard } from '../../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../../types';
import { isBurnAddress } from '../../../utils/helpers';
import AirdropModule, { AirdropModuleMetadata } from '../airdrop';
import HoneyPotChecker from '../../../utils/honeypot';
import Logger from '../../../utils/logger';

export const SLEEP_MINT_MODULE_KEY = 'SleepMint';
export const SLEEP_MINT_RECEIVERS_THRESHOLD = 4;
export const CONCURRENCY = 30;

// Exception:
// https://etherscan.io/token/0xf6fd82dedbbe0ffadb5e1ecc2a283ab52b9ed2b0?a=0x0000000000000000000000000000000000000001

type SleepMintInfo = {
  from: string;
  to: string;
  sender: string;
  txHash: string;
  isPassivelyApproved: boolean;
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

  constructor(private honeypotChecker: HoneyPotChecker) {
    super();
  }

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, storage, memoizer, provider, blockNumber, context } = params;

    let detected = false;
    let metadata: SleepMintModuleMetadata | undefined = undefined;

    const memo = memoizer.getScope(token.address);

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
      allApprovalEvents.push(...(storage.erc20ApprovalEventsByToken.get(token.address) || []));
    } else if (token.type === TokenStandard.Erc721) {
      const approvalEvents = storage.erc721ApprovalEventsByToken.get(token.address) || new Set();
      const approvalForAllEvents =
        storage.erc721ApprovalForAllEventsByToken.get(token.address) || new Set();

      approvalEvents.forEach((e) => allApprovalEvents.push({ ...e, spender: e.approved }));
      approvalForAllEvents.forEach((e) => allApprovalEvents.push({ ...e, spender: e.operator }));
    } else if (token.type === TokenStandard.Erc1155) {
      const approvalForAllEvents =
        storage.erc1155ApprovalForAllEventsByToken.get(token.address) || [];

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

    let transferEvents: Set<{ from: string; to: string; transaction: SimplifiedTransaction }> =
      new Set();

    if (token.type === TokenStandard.Erc20) {
      transferEvents = storage.erc20TransferEventsByToken.get(token.address) || new Set();
    } else if (token.type === TokenStandard.Erc721) {
      transferEvents = storage.erc721TransferEventsByToken.get(token.address) || new Set();
    } else if (token.type === TokenStandard.Erc1155) {
      transferEvents = storage.erc1155TransferSingleEventsByToken.get(token.address) || new Set();
      storage.erc1155TransferBatchEventsByToken
        .get(token.address)
        ?.forEach((e) => transferEvents.add(e));
    }

    // TODO LIMIT

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

      const isPassivelyApproved =
        passiveApprovals.get(event.from)?.has(event.transaction.from) || false;

      sleepMintSet.add({
        from: event.from,
        to: event.to,
        sender: event.transaction.from,
        txHash: event.transaction.hash,
        isPassivelyApproved,
      });
    }

    const honeypotQueue = queue<SleepMintInfo>(async (mint, callback) => {
      try {
        const owner = mint.from;

        const { isHoneypot } = await memo('honeypot', [owner], () => {
          Logger.debug(`HoneyPot scanning: ${owner}`);
          return this.honeypotChecker.testAddress(owner, provider, blockNumber);
        });

        if (!isHoneypot) {
          sleepMintSet.delete(mint);
        }

        callback();
      } catch (e: any) {
        Logger.error(e);
        honeypotQueue.remove(() => true);
        callback();
      }
    }, CONCURRENCY);

    Logger.debug(`Fetching honeypot info for ${sleepMintSet.size} accounts...`);
    honeypotQueue.push([...sleepMintSet]);

    if (!honeypotQueue.idle()) {
      await honeypotQueue.drain();
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
