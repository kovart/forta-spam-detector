import { AIRDROP_MODULE_KEY, AirdropModuleMetadata } from './airdrop';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const LOW_ACTIVITY_MODULE_KEY = 'LowActivityAfterAirdrop';
export const MIN_AIRDROP_RECEIVERS = 200;
export const MIN_ACTIVE_RECEIVERS_RATE = 0.0025; // 0.25%
export const DELAY_AFTER_AIRDROP = 20 * 24 * 60 * 60; // 20d

export type LowActivityModuleMetadata = {
  activeReceivers: string[];
};

export type LowActivityModuleShortMetadata = {
  activeReceiverCount: number;
  activeReceiverShortList: string[];
};

class LowActivityAfterAirdropModule extends AnalyzerModule {
  static Key = LOW_ACTIVITY_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, timestamp, transformer, context } = params;

    let detected = false;
    let metadata: LowActivityModuleMetadata | undefined = undefined;

    context[LOW_ACTIVITY_MODULE_KEY] = { detected, metadata };

    const airdropMetadata = context[AIRDROP_MODULE_KEY].metadata as AirdropModuleMetadata;

    const receiverSet = new Set<string>();
    let minReceiversFulfilledAt: number = -1;
    for (const transfer of airdropMetadata.transfers) {
      receiverSet.add(transfer.receiver);
      if (receiverSet.size >= MIN_AIRDROP_RECEIVERS) {
        minReceiversFulfilledAt = transfer.timestamp;
        break;
      }
    }

    if (minReceiversFulfilledAt === -1) return;
    if (timestamp - minReceiversFulfilledAt <= DELAY_AFTER_AIRDROP) return;

    const transactionSet = transformer.transactions(token);
    const senderSet = new Set<string>();

    transactionSet.forEach((t) => senderSet.add(t.from));

    const activeReceivers = airdropMetadata.receivers.filter((r) => senderSet.has(r));

    if (
      activeReceivers.length >=
      Math.round(airdropMetadata.receivers.length * MIN_ACTIVE_RECEIVERS_RATE)
    ) {
      return;
    }

    detected = true;
    metadata = { activeReceivers };

    context[LOW_ACTIVITY_MODULE_KEY] = { detected, metadata };
  }

  simplifyMetadata(metadata: LowActivityModuleMetadata): LowActivityModuleShortMetadata {
    return {
      activeReceiverCount: metadata.activeReceivers.length,
      activeReceiverShortList: metadata.activeReceivers.slice(0, 15),
    };
  }
}

export default LowActivityAfterAirdropModule;
