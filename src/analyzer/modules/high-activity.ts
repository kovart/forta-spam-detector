import { SimplifiedTransaction, TokenStandard } from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const HIGH_ACTIVITY_MODULE_KEY = 'HighActivity';
export const UNIQUE_SENDERS_THRESHOLD = 60;

export type HighActivityModuleMetadata = {
  senders: string[];
  startTime: number;
  endTime: number;
};

export type HighActivityModuleShortMetadata = {
  senderCount: number;
  senderShortList: string[];
  startTime: number;
  endTime: number;
};

class HighActivityModule extends AnalyzerModule {
  static Key = HIGH_ACTIVITY_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, storage, context } = params;

    let detected = false;
    let metadata: HighActivityModuleMetadata | undefined = undefined;

    const sendersSet = new Set<string>();
    const transactionSet = new Set<SimplifiedTransaction>();

    const directTransactions = storage.transactionsByToken.get(token.address) || [];
    directTransactions.forEach((t) => transactionSet.add(t));

    // Events in a token contract are not always triggered by transactions directly to the contract
    if (token.type === TokenStandard.Erc20) {
      const transferEvents = storage.erc20TransferEventsByToken.get(token.address) || [];
      const approvalEvents = storage.erc20ApprovalEventsByToken.get(token.address) || [];
      transferEvents.forEach((e) => transactionSet.add(e.transaction));
      approvalEvents.forEach((e) => transactionSet.add(e.transaction));
    } else if (token.type === TokenStandard.Erc721) {
      const transferEvents = storage.erc721TransferEventsByToken.get(token.address) || [];
      const approvalEvents = storage.erc721ApprovalEventsByToken.get(token.address) || [];
      const approvalForAllEvents =
        storage.erc721ApprovalForAllEventsByToken.get(token.address) || [];
      transferEvents.forEach((e) => transactionSet.add(e.transaction));
      approvalEvents.forEach((e) => transactionSet.add(e.transaction));
      approvalForAllEvents.forEach((e) => transactionSet.add(e.transaction));
    } else if (token.type === TokenStandard.Erc1155) {
      const transferSingleEvents =
        storage.erc1155TransferSingleEventsByToken.get(token.address) || [];
      const transferBatchEvents =
        storage.erc1155TransferBatchEventsByToken.get(token.address) || [];
      const approvalForAllEvents =
        storage.erc1155ApprovalForAllEventsByToken.get(token.address) || [];
      transferSingleEvents.forEach((e) => transactionSet.add(e.transaction));
      transferBatchEvents.forEach((e) => transactionSet.add(e.transaction));
      approvalForAllEvents.forEach((e) => transactionSet.add(e.transaction));
    }

    transactionSet.forEach((t) => sendersSet.add(t.from));

    detected = sendersSet.size > UNIQUE_SENDERS_THRESHOLD;
    metadata = {
      senders: [...sendersSet],
      startTime: token.timestamp,
      endTime: params.timestamp,
    };

    context[HIGH_ACTIVITY_MODULE_KEY] = { detected, metadata };

    return { interrupt: detected };
  }

  simplifyMetadata(metadata: HighActivityModuleMetadata): HighActivityModuleShortMetadata {
    return {
      senderCount: metadata.senders.length,
      senderShortList: metadata.senders.slice(15),
      startTime: metadata.startTime,
      endTime: metadata.endTime,
    };
  }
}

export default HighActivityModule;
