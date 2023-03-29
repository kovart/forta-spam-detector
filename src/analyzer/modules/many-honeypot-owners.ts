import { AIRDROP_MODULE_KEY, AirdropModuleMetadata } from './airdrop';
import HoneyPotChecker, { HoneypotAnalysisMetadata } from '../../utils/honeypot';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY = 'TooManyHoneyPotOwners';
export const HONEYPOT_THRESHOLD = 8;

type Honeypot = { address: string; metadata: HoneypotAnalysisMetadata };

export type TooManyHoneyPotOwnersMetadata = {
  honeypots: Honeypot[];
};

class TooManyHoneyPotOwnersModule extends AnalyzerModule {
  static Key = TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY;

  constructor(private honeypotChecker: HoneyPotChecker) {
    super();
  }

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, provider, memoizer, blockNumber } = params;

    let detected = false;
    let metadata: TooManyHoneyPotOwnersMetadata | undefined = undefined;

    const memo = memoizer.getScope(token.address);

    const airdropContext = context[AIRDROP_MODULE_KEY];
    const airdropMetadata = airdropContext.metadata as AirdropModuleMetadata;

    const honeypots: Honeypot[] = [];

    if (airdropMetadata) {
      const receivers = airdropMetadata.receivers;

      for (const receiver of receivers) {
        if (receiver === token.deployer || receiver === token.address) continue;

        const result = await memo('honeypot', [receiver], () =>
          this.honeypotChecker.testAddress(receiver, provider, blockNumber),
        );

        if (result.honeypot) {
          honeypots.push({ address: receiver, metadata: result.metadata });
        }
      }
    }

    if (honeypots.length >= HONEYPOT_THRESHOLD) {
      detected = true;
      metadata = { honeypots };
    }

    context[TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY] = { detected, metadata };
  }
}

export default TooManyHoneyPotOwnersModule;
