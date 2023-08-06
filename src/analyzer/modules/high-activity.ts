import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';
import { TOO_MUCH_AIRDROP_ACTIVITY_MODULE_KEY } from './airdrop-activity';
import { LOW_ACTIVITY_MODULE_KEY } from './low-activity';
import { MULTIPLE_OWNERS_MODULE_KEY } from './multiple-owners';
import { NON_UNIQUE_TOKENS_MODULE_KEY } from './non-unique-tokens';
import { FALSE_TOTAL_SUPPLY_MODULE_KEY } from './total-supply';
import { SILENT_MINT_MODULE_KEY } from './silent-mint';
import { SLEEP_MINT_MODULE_KEY } from './sleep-mint';
import { TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY } from './honeypot-owners';
import { TOO_MANY_CREATIONS_MODULE_KEY } from './many-creations';
import { PHISHING_METADATA_MODULE_KEY } from './phishing-metadata';
import { HONEY_POT_SHARE_MODULE_KEY } from './honeypot-dominance';
import { TOKEN_IMPERSONATION_MODULE_KEY } from './token-impersonation';
import AirdropModule, { AirdropModuleMetadata } from './airdrop';

export const HIGH_ACTIVITY_MODULE_KEY = 'HighActivity';
export const MIN_UNIQUE_SENDERS_TOTAL = 250;
export const MIN_UNIQUE_SENDERS_IN_WINDOW = 120;
export const WINDOW_PERIOD = 7 * 24 * 60 * 60; // 7d
export const MIN_ACTIVE_RECEIVER_COUNT = 10;
export const MIN_ACTIVE_RECEIVER_RATE = 0.15; // 15%

export type HighActivityModuleMetadata = {
  senders: string[];
  activeReceivers: string[];
  startTime: number;
  endTime: number;
  windowPeriod: number;
  maxSenderCountInWindow: number;
};

export type HighActivityModuleShortMetadata = {
  senderCount: number;
  senderShortList: string[];
  activeReceiverCount: number;
  activeReceiverShortList: string[];
  startTime: number;
  endTime: number;
  windowPeriod: number;
  maxSenderCountInWindow: number;
};

export const SUSPICIOUS_MULTIPLIERS: { [moduleKey: string]: number } = {
  [TOO_MUCH_AIRDROP_ACTIVITY_MODULE_KEY]: 1.5,
  [LOW_ACTIVITY_MODULE_KEY]: 1.3,
  [MULTIPLE_OWNERS_MODULE_KEY]: 4,
  [NON_UNIQUE_TOKENS_MODULE_KEY]: 1.5,
  [FALSE_TOTAL_SUPPLY_MODULE_KEY]: 2,
  [SILENT_MINT_MODULE_KEY]: 1.1,
  [SLEEP_MINT_MODULE_KEY]: 1.5,
  [TOO_MANY_CREATIONS_MODULE_KEY]: 1.5,
  [PHISHING_METADATA_MODULE_KEY]: 2,
  [TOO_MANY_HONEY_POT_OWNERS_MODULE_KEY]: 2,
  [HONEY_POT_SHARE_MODULE_KEY]: 1.5,
  [TOKEN_IMPERSONATION_MODULE_KEY]: 3,
};

class HighActivityModule extends AnalyzerModule {
  static Key = HIGH_ACTIVITY_MODULE_KEY;

  private multipliers: typeof SUSPICIOUS_MULTIPLIERS;

  constructor(moduleMultipliers = SUSPICIOUS_MULTIPLIERS) {
    super();
    this.multipliers = moduleMultipliers;
  }

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, transformer, context } = params;

    let detected = false;
    let metadata: HighActivityModuleMetadata | undefined = undefined;

    const airdropMetadata = context[AirdropModule.Key].metadata as AirdropModuleMetadata;

    let suspiciousMultiplier = 1;
    for (const moduleKey of Object.keys(context)) {
      if (context[moduleKey]?.detected && this.multipliers[moduleKey] != null) {
        suspiciousMultiplier *= this.multipliers[moduleKey];
      }
    }

    const transactionSet = await transformer.transactions(token);
    const senderSet = new Set<string>([...transactionSet].map((t) => t.from));
    const receiverSet = new Set(airdropMetadata.receivers);
    const activeReceivers = [...receiverSet].filter((r) => senderSet.has(r));

    // Check active receivers

    detected =
      activeReceivers.length >= MIN_ACTIVE_RECEIVER_COUNT &&
      activeReceivers.length / receiverSet.size >= MIN_ACTIVE_RECEIVER_RATE;

    // Check total active accounts

    detected = detected || senderSet.size > MIN_UNIQUE_SENDERS_TOTAL * suspiciousMultiplier;

    let maxSenderCountInWindow = -1;
    if (!detected) {
      maxSenderCountInWindow = 0;

      const transactions = Array.from(transactionSet);
      for (let i = 0; i < transactions.length; i++) {
        const startTransaction = transactions[i];
        const senderSet = new Set<string>();

        for (let y = i; y < transactions.length; y++) {
          const endTransaction = transactions[y];

          if (endTransaction.timestamp - startTransaction.timestamp > WINDOW_PERIOD) break;

          senderSet.add(endTransaction.from);
        }

        maxSenderCountInWindow = Math.max(maxSenderCountInWindow, senderSet.size);
      }

      detected = maxSenderCountInWindow >= MIN_UNIQUE_SENDERS_IN_WINDOW * suspiciousMultiplier;
    }

    metadata = {
      senders: [...senderSet],
      activeReceivers: activeReceivers,
      startTime: token.timestamp,
      endTime: params.timestamp,
      windowPeriod: WINDOW_PERIOD,
      maxSenderCountInWindow: maxSenderCountInWindow,
    };

    context[HIGH_ACTIVITY_MODULE_KEY] = { detected, metadata };

    return { interrupt: detected };
  }

  simplifyMetadata(metadata: HighActivityModuleMetadata): HighActivityModuleShortMetadata {
    return {
      senderCount: metadata.senders.length,
      senderShortList: metadata.senders.slice(0, 15),
      activeReceiverCount: metadata.activeReceivers.length,
      activeReceiverShortList: metadata.activeReceivers.slice(0, 15),
      startTime: metadata.startTime,
      endTime: metadata.endTime,
      windowPeriod: WINDOW_PERIOD,
      maxSenderCountInWindow: metadata.maxSenderCountInWindow,
    };
  }
}

export default HighActivityModule;
