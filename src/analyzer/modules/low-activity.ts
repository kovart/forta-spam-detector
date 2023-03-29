import { AIRDROP_MODULE_KEY, AirdropModuleMetadata } from './airdrop';
import { HIGH_ACTIVITY_MODULE_KEY, HighActivityModuleMetadata } from './high-activity';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const LOW_ACTIVITY_MODULE_KEY = 'LowActivityAfterAirdrop';
export const MIN_AIRDROP_RECEIVERS = 100;
export const MIN_ACTIVE_RECEIVERS = 7;
export const DELAY_AFTER_AIRDROP = 4 * 24 * 60 * 60; // 4d

export type LowActivityAfterAirdropMetadata = {
  activeReceivers: string[];
};

class LowActivityAfterAirdropModule extends AnalyzerModule {
  static Key = LOW_ACTIVITY_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { timestamp, context } = params;

    let detected = false;
    let metadata: LowActivityAfterAirdropMetadata | undefined = undefined;

    const airdropMetadata = context[AIRDROP_MODULE_KEY].metadata as AirdropModuleMetadata;
    const activityMetadata = context[HIGH_ACTIVITY_MODULE_KEY]
      .metadata as HighActivityModuleMetadata;

    if (airdropMetadata.receivers.length < MIN_AIRDROP_RECEIVERS) return;
    if (airdropMetadata.airdropStartTime + DELAY_AFTER_AIRDROP < timestamp) return;

    const senderSet = new Set(activityMetadata.senders);
    const activeReceivers = airdropMetadata.receivers.filter((r) => senderSet.has(r));

    if (activeReceivers.length >= MIN_ACTIVE_RECEIVERS) return;

    detected = true;
    metadata = { activeReceivers };

    context[LOW_ACTIVITY_MODULE_KEY] = { detected, metadata };
  }
}

export default LowActivityAfterAirdropModule;
