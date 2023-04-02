import { ethers } from 'ethers';
import { shuffle } from 'lodash';

import { TokenEvent, TokenStandard } from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const SLEEP_MINT_MODULE_KEY = 'SleepMint';

type SleepMintInfo = {
  owner: string;
  spender: string;
  isPassivelyApproved: boolean;
};

export type SleepMintModuleMetadata = {
  sleepMintTxs: string[];
  sleepMints: SleepMintInfo[];
};

export type SleepMintModuleShortMetadata = {
  sleepMintCount: number;
  sleepMintShortList: SleepMintInfo[];
  sleepMintTxCount: number;
  sleepMintTxShortList: string[];
};

class SleepMintModule extends AnalyzerModule {
  static Key = SLEEP_MINT_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, storage, memoizer, provider, context } = params;

    let detected = false;
    let metadata: SleepMintModuleMetadata | undefined = undefined;

    context[SLEEP_MINT_MODULE_KEY] = { detected, metadata };

    const memo = memoizer.getScope(token.address);

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

    const sleepMintTxSet = new Set<string>();
    const sleepMintsByOwner = new Map<string, SleepMintInfo[]>();
    if (token.type === TokenStandard.Erc20) {
      const transferEvents = storage.erc20TransferEventsByToken.get(token.address) || [];

      for (const event of transferEvents) {
        if (
          event.from === ethers.constants.AddressZero ||
          event.transaction.from === event.from ||
          event.transaction.from === event.to ||
          event.from === token.address
        )
          continue;

        // Skip if transaction is legal
        if (directApprovals.get(event.from)?.has(event.transaction.from)) continue;

        const code = await memo('getCode', [event.from], () => provider.getCode(event.from));

        // Contracts sometimes cause FP, such as in this transaction:
        // https://etherscan.io/tx/0x5eb2f12136d80a45cace29b1dfccb4213b097444694cb23ed9960ed5bc6c89c7
        if (code !== '0x') continue;

        const isPassivelyApproved =
          passiveApprovals.get(event.from)?.has(event.transaction.from) || false;

        let mints = sleepMintsByOwner.get(event.from);
        if (!mints) {
          mints = [];
          sleepMintsByOwner.set(event.to, mints);
        }
        mints.push({ owner: event.from, spender: event.to, isPassivelyApproved });
        sleepMintTxSet.add(event.transaction.hash);
      }
    }

    if (sleepMintTxSet.size > 0) {
      detected = true;
      metadata = {
        sleepMints: [...sleepMintsByOwner.values()].flat(),
        sleepMintTxs: [...sleepMintTxSet],
      };
    }

    context[SLEEP_MINT_MODULE_KEY] = { detected, metadata };
  }

  simplifyMetadata(metadata: SleepMintModuleMetadata): SleepMintModuleShortMetadata {
    return {
      sleepMintCount: metadata.sleepMints.length,
      sleepMintShortList: shuffle(metadata.sleepMints).slice(0, 15),
      sleepMintTxCount: metadata.sleepMintTxs.length,
      sleepMintTxShortList: shuffle(metadata.sleepMintTxs).slice(0, 15),
    };
  }
}

export default SleepMintModule;
