import { AIRDROP_MODULE_KEY, AirdropModuleMetadata } from './airdrop';
import { HIGH_ACTIVITY_MODULE_KEY, HighActivityModuleMetadata } from './high-activity';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const LOW_ACTIVITY_MODULE_KEY = 'LowActivityAfterAirdrop';
export const MIN_AIRDROP_RECEIVERS = 100;
export const MIN_ACTIVE_RECEIVERS = 5;
export const DELAY_AFTER_AIRDROP = 14 * 24 * 60 * 60; // 14d

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
    const { timestamp, context } = params;

    let detected = false;
    let metadata: LowActivityModuleMetadata | undefined = undefined;

    context[LOW_ACTIVITY_MODULE_KEY] = { detected, metadata };

    const airdropMetadata = context[AIRDROP_MODULE_KEY].metadata as AirdropModuleMetadata;
    const activityMetadata = context[HIGH_ACTIVITY_MODULE_KEY]
      .metadata as HighActivityModuleMetadata;

    if (airdropMetadata.receivers.length < MIN_AIRDROP_RECEIVERS) return;
    if (airdropMetadata.startTime + DELAY_AFTER_AIRDROP < timestamp) return;

    const senderSet = new Set(activityMetadata.senders);
    const activeReceivers = airdropMetadata.receivers.filter((r) => senderSet.has(r));

    if (activeReceivers.length >= MIN_ACTIVE_RECEIVERS) return;

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
