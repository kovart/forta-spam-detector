import { ethers } from 'ethers';
import { groupBy, shuffle } from 'lodash';

import { SimplifiedTransaction, TokenEvent, TokenStandard } from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { isAccountAbstraction, isBurnAddress } from '../../utils/helpers';
import AirdropModule, { AIRDROP_MODULE_KEY, AirdropModuleMetadata } from './airdrop';
import { erc20Iface } from '../../contants';
import Logger from '../../utils/logger';
import { TOKEN_IMPERSONATION_MODULE_KEY } from './token-impersonation';

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

const PairIface = new ethers.utils.Interface([
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
]);

class SleepMintModule extends AnalyzerModule {
  static Key = SLEEP_MINT_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, storage, context, provider, memoizer } = params;

    let detected = false;
    let metadata: SleepMintModuleMetadata | undefined = undefined;

    context[SLEEP_MINT_MODULE_KEY] = { detected, metadata };

    if (![AIRDROP_MODULE_KEY, TOKEN_IMPERSONATION_MODULE_KEY].some((key) => context[key]?.detected))
      return;

    const memo = memoizer.getScope(token.address);

    const airdropMetadata = context[AirdropModule.Key].metadata as AirdropModuleMetadata;
    const airdropTxHashes = airdropMetadata.txHashes;

    // Map owner -> spenders
    // A bit of a simplified structure, with no knowledge of a particular token or values.
    // However, in theory this is not important in this context.
    const directApprovals = new Map<string, Set<string>>();
    const passiveApprovals = new Map<string, Set<string>>();

    // Collect and normalize approval events so that we can apply common handlers for them
    const allApprovalEvents = new Set<TokenEvent & { owner: string; spender: string }>();

    if (token.type === TokenStandard.Erc20) {
      for (const event of await storage.getErc20ApprovalEvents(token.address)) {
        allApprovalEvents.add(event);
      }
    } else if (token.type === TokenStandard.Erc721) {
      const approvalEvents = await storage.getErc721ApprovalEvents(token.address);
      for (const event of approvalEvents) {
        allApprovalEvents.add({ ...event, spender: event.approved });
      }

      const approvalForAllEvents = await storage.getErc721ApprovalForAllEvents(token.address);
      for (const event of approvalForAllEvents) {
        allApprovalEvents.add({ ...event, spender: event.operator });
      }
    } else if (token.type === TokenStandard.Erc1155) {
      const approvalForAllEvents = await storage.getErc1155ApprovalForAllEvents(token.address);
      for (const event of approvalForAllEvents) {
        allApprovalEvents.add({ ...event, spender: event.operator });
      }
    }

    // Prepare approval sets (performance optimizations)
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

    // Fill transfer events

    let sleepMints: SleepMintInfo[] = [];
    let transferEvents: { from: string; to: string; transaction: SimplifiedTransaction }[] = [];
    const airdropTxHashSet = new Set(airdropTxHashes);

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

    // Check transfer events

    for (const event of transferEvents) {
      if (
        event.from === ethers.constants.AddressZero ||
        event.transaction.from === event.from ||
        event.transaction.from === event.to ||
        event.from === token.address ||
        event.from === token.deployer ||
        event.to === token.deployer ||
        isBurnAddress(event.to) ||
        !airdropTxHashSet.has(event.transaction.hash)
      ) {
        continue;
      }

      // Skip if transaction is legal
      if (directApprovals.get(event.from)?.has(event.transaction.from)) continue;

      sleepMints.push({
        from: event.from,
        to: event.to,
        sender: event.transaction.from,
        txHash: event.transaction.hash,
      });
    }

    const ownerSet = new Set(sleepMints.map((m) => m.from));

    // Check if there are too many different owners ('from' accounts)
    if (ownerSet.size < 50) {
      // Remove sleep mints from an account abstraction (e.g. Gnosis-Safe)
      for (const owner of ownerSet) {
        const isAbstraction = await memo('isAccountAbstraction', [owner], () =>
          isAccountAbstraction(owner, provider),
        );

        if (isAbstraction) {
          sleepMints = sleepMints.filter((m) => m.from !== owner);
        }
      }
    }

    const receiverSet = new Set(sleepMints.map((m) => m.to));

    if (receiverSet.size > SLEEP_MINT_RECEIVERS_THRESHOLD) {
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
              // There can only be one sender in a tx
              const sender = mints[0].sender;

              // Check allowance with direct contract calls in order to avoid db anomaly caused by tx drops
              try {
                const erc20Contract = new ethers.Contract(token.address, erc20Iface, provider);
                const allowance = await erc20Contract.allowance(owner, sender);

                const isFalseDetection = allowance.toString() !== '0';

                if (isFalseDetection) continue;
              } catch (e) {
                Logger.warn(e);
                // Not implemented?
              }

              // Check if it is kind of Disperse app, which has the following flow:
              // 1. Sender transfers funds to the owner
              // 2. Owner transfers to other receivers
              // -----------
              // Example txs:
              // - https://etherscan.io/tx/0xb87f93b0ccd6b7a1db0284e50d4c9affd0ba2de421a420d91d914bef76418033
              // - https://etherscan.io/tx/0x0dbee11ad397b07888706f188e158cdfe0825640b1311c66960effd68e79737a
              if (transferEvents.find((e) => e.from === sender && e.to === owner)) {
                continue;
              }

              // Check if it is a pair contract
              // E.g. https://etherscan.io/tx/0x08bb1a91ff8ab76424908b73183fafa96d427d314829c3133ecd3ab6dc2cd6d2
              const isOwnerPairContract = await memo('isOwnerPairContract', [owner], async () => {
                try {
                  const pairContract = new ethers.Contract(owner, PairIface, provider);
                  return [await pairContract.token0(), await pairContract.token1()]
                    .map((v) => v.toLowerCase())
                    .includes(token.address);
                } catch {
                  // it is not a pair contract
                }

                return false;
              });

              const isAccountContract = await memo('isAccountAbstraction', [owner], () =>
                isAccountAbstraction(owner, provider),
              );

              if (isOwnerPairContract || isAccountContract) continue;

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
