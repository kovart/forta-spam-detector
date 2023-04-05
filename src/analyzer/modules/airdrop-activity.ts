import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import AirdropModule, { AirdropModuleMetadata } from './airdrop';

export const TOO_MUCH_AIRDROP_ACTIVITY_MODULE_KEY = 'TooMuchAirdropActivity';
export const AIRDROP_DURATION_THRESHOLD = 1.5 * 30 * 24 * 60 * 60; // 1.5 month
export const RECEIVERS_THRESHOLD = 15_000;

export type TooMuchAirdropActivityModuleMetadata = {
  receiverCount: number;
  duration: number;
};

class TooMuchAirdropActivityModule extends AnalyzerModule {
  static Key = TOO_MUCH_AIRDROP_ACTIVITY_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { context } = params;

    let detected = false;
    let metadata: TooMuchAirdropActivityModuleMetadata | undefined = undefined;

    const airdropMetadata = context[AirdropModule.Key].metadata as AirdropModuleMetadata;
    const { receivers, startTime, endTime } = airdropMetadata;

    const duration = endTime - startTime;

    if (duration > AIRDROP_DURATION_THRESHOLD && receivers.length > RECEIVERS_THRESHOLD) {
      detected = true;
      metadata = {
        receiverCount: receivers.length,
        duration: duration,
      };
    }

    context[TOO_MUCH_AIRDROP_ACTIVITY_MODULE_KEY] = { detected, metadata };
  }
}

export default TooMuchAirdropActivityModule;
