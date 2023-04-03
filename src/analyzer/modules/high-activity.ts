import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const HIGH_ACTIVITY_MODULE_KEY = 'HighActivity';
export const MIN_UNIQUE_SENDERS_TOTAL = 90;
export const MIN_UNIQUE_SENDERS_IN_WINDOW_TIME = 30;
export const WINDOW_TIME = 7 * 24 * 60 * 60; // 7d

export type HighActivityModuleMetadata = {
  senders: string[];
  startTime: number;
  endTime: number;
  maxSenderCountInWindow: number;
};

export type HighActivityModuleShortMetadata = {
  senderCount: number;
  senderShortList: string[];
  startTime: number;
  endTime: number;
  maxSenderCountInWindow: number;
};

class HighActivityModule extends AnalyzerModule {
  static Key = HIGH_ACTIVITY_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, transformer, context } = params;

    let detected = false;
    let metadata: HighActivityModuleMetadata | undefined = undefined;

    const transactionSet = transformer.transactions(token);
    const senderSet = new Set<string>([...transactionSet].map((t) => t.from));

    detected = senderSet.size > MIN_UNIQUE_SENDERS_TOTAL;

    let maxSenderCountInWindow = 0;
    if (!detected) {
      const transactions = Array.from(transactionSet);
      for (let i = 0; i < transactions.length; i++) {
        const startTransaction = transactions[i];
        const senderSet = new Set<string>();

        for (let y = i; y < transactions.length; y++) {
          const endTransaction = transactions[y];

          if (endTransaction.timestamp - startTransaction.timestamp > WINDOW_TIME) break;

          senderSet.add(endTransaction.from);
        }

        maxSenderCountInWindow = Math.max(maxSenderCountInWindow, senderSet.size);
      }

      detected = maxSenderCountInWindow >= MIN_UNIQUE_SENDERS_IN_WINDOW_TIME;
    }

    metadata = {
      senders: [...senderSet],
      startTime: token.timestamp,
      endTime: params.timestamp,
      maxSenderCountInWindow: maxSenderCountInWindow,
    };

    context[HIGH_ACTIVITY_MODULE_KEY] = { detected, metadata };

    return { interrupt: detected };
  }

  simplifyMetadata(metadata: HighActivityModuleMetadata): HighActivityModuleShortMetadata {
    return {
      senderCount: metadata.senders.length,
      senderShortList: metadata.senders.slice(0, 15),
      startTime: metadata.startTime,
      endTime: metadata.endTime,
      maxSenderCountInWindow: metadata.maxSenderCountInWindow,
    };
  }
}

export default HighActivityModule;
