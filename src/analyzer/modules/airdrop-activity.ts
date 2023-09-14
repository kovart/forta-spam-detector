import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { AIRDROP_MODULE_KEY, AirdropModuleMetadata } from './airdrop';
import { TOKEN_IMPERSONATION_MODULE_KEY } from './token-impersonation';

export const TOO_MUCH_AIRDROP_ACTIVITY_MODULE_KEY = 'TooMuchAirdropActivity';
export const AIRDROP_DURATION_THRESHOLD = 1 * 30 * 24 * 60 * 60; // 1 month
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

    context[TOO_MUCH_AIRDROP_ACTIVITY_MODULE_KEY] = { detected, metadata };

    if (
      ![AIRDROP_MODULE_KEY, TOKEN_IMPERSONATION_MODULE_KEY].some((key) => context[key]?.detected)
    ) {
      return;
    }

    const airdropMetadata = context[AIRDROP_MODULE_KEY].metadata as AirdropModuleMetadata;
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
