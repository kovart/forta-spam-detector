import { BigNumber as EtherBigNumber } from 'ethers';
import { TransactionEvent } from 'forta-agent';

import SqlDatabase from './database';
import { SimplifiedTransaction, TokenContract } from './types';
import { erc1155Iface, erc20Iface, erc721Iface } from './contants';

class DataStorage {
  private tokenByAddress = new Map<string, TokenContract>();
  private lastBlockNumber: number | null = null;
  private lastTxIndex: number | null = null;

  constructor(public db: SqlDatabase) {}

  async initialize() {
    await this.db.initialize();

    const tokens = await this.db.getTokens();

    for (const token of tokens) {
      this.tokenByAddress.set(token.address, token);
    }
  }

  addToken(token: TokenContract) {
    if (this.tokenByAddress.has(token.address)) return;

    this.tokenByAddress.set(token.address, token);
    this.db.addToken(token);
  }

  async handleTx(txEvent: TransactionEvent) {
    const txIndex = txEvent.blockNumber === this.lastBlockNumber ? this.lastTxIndex! + 1 : 0;

    this.lastBlockNumber = txEvent.blockNumber;
    this.lastTxIndex = txIndex;

    const transaction: SimplifiedTransaction = {
      hash: txEvent.hash,
      from: txEvent.from,
      to: txEvent.to,
      sighash: txEvent.transaction.data.slice(0, 10),
      blockNumber: txEvent.blockNumber,
      timestamp: txEvent.timestamp,
      index: txIndex,
    };

    const logs = txEvent.logs.filter((l) => this.tokenByAddress.has(l.address.toLowerCase()));

    // Check if there is any trace of the monitoring tokens
    if (!(txEvent.to && this.tokenByAddress.has(txEvent.to.toLowerCase())) && logs.length === 0) {
      return;
    }

    const transactionId = await this.db.addTransaction(transaction);

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const contractAddress = log.address.toLowerCase();

      try {
        const parsedErc20Log = erc20Iface.parseLog(log);
        if (parsedErc20Log.name === 'Transfer') {
          const { from, to, value } = parsedErc20Log.args;
          this.db.addErc20TransferEvent({
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            value: BigInt(value.toString()),
            contract: contractAddress,
            transactionId: transactionId,
            logIndex: log.logIndex,
          });
        } else if (parsedErc20Log.name === 'Approval') {
          const { owner, spender, value } = parsedErc20Log.args;
          this.db.addErc20ApprovalEvent({
            owner: owner.toLowerCase(),
            spender: spender.toLowerCase(),
            value: BigInt(value.toString()),
            transactionId: transactionId,
            contract: contractAddress,
            logIndex: log.logIndex,
          });
        }
        continue;
      } catch {
        // ignore
      }

      try {
        const parsedErc721Log = erc721Iface.parseLog(log);

        if (parsedErc721Log.name === 'Transfer') {
          const { from, to, tokenId } = parsedErc721Log.args;
          this.db.addErc721TransferEvent({
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            tokenId: tokenId.toString(),
            contract: contractAddress,
            transactionId: transactionId,
            logIndex: log.logIndex,
          });
        } else if (parsedErc721Log.name === 'Approval') {
          const { owner, approved, tokenId } = parsedErc721Log.args;
          this.db.addErc721ApprovalEvent({
            owner: owner.toLowerCase(),
            approved: approved.toLowerCase(),
            tokenId: tokenId.toString(),
            transactionId: transactionId,
            contract: contractAddress,
            logIndex: log.logIndex,
          });
        } else if (parsedErc721Log.name === 'ApprovalForAll') {
          const { owner, operator, approved } = parsedErc721Log.args;
          this.db.addErc721ApprovalForAllEvent({
            owner: owner.toLowerCase(),
            operator: operator.toLowerCase(),
            approved: approved,
            transactionId: transactionId,
            contract: contractAddress,
            logIndex: log.logIndex,
          });
        }

        continue;
      } catch {
        // ignore
      }

      try {
        const parsedErc1155Log = erc1155Iface.parseLog(log);

        if (parsedErc1155Log.name === 'TransferSingle') {
          const { operator, from, to, id, value } = parsedErc1155Log.args;
          this.db.addErc1155TransferSingleEvent({
            operator: operator.toLowerCase(),
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            tokenId: id.toString(),
            value: BigInt(value.toString()),
            transactionId: transactionId,
            contract: contractAddress,
            logIndex: log.logIndex,
          });
        } else if (parsedErc1155Log.name === 'TransferBatch') {
          const { operator, from, to, ids } = parsedErc1155Log.args;
          this.db.addErc1155TransferBatchEvent({
            operator: operator.toLowerCase(),
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            ids: ids.map((id: EtherBigNumber) => id.toString()),
            values: parsedErc1155Log.args[4].map((v: EtherBigNumber) => BigInt(v.toString())),
            transactionId: transactionId,
            contract: contractAddress,
            logIndex: log.logIndex,
          });
        } else if (parsedErc1155Log.name === 'ApprovalForAll') {
          const { account, operator, approved } = parsedErc1155Log.args;
          this.db.addErc1155ApprovalForAllEvent({
            owner: account.toLowerCase(),
            operator: operator.toLowerCase(),
            approved: approved,
            transactionId: transactionId,
            contract: contractAddress,
            logIndex: log.logIndex,
          });
        }
      } catch {
        // ignore
      }

      // memory optimization
      if ((i + 1) % 40 == 0) await this.db.wait();
    }
  }

  getTokens() {
    return Array.from(this.tokenByAddress.values());
  }

  hasToken(address: string) {
    return this.tokenByAddress.has(address);
  }

  deleteToken(address: string) {
    this.tokenByAddress.delete(address);
    this.db.clearToken(address);
  }

  getTransactions(to: string | null) {
    return this.db.getTransactions({ to });
  }

  getErc20TransferEvents(contract: string) {
    return this.db.getErc20TransferEvents({ contract });
  }

  getErc20ApprovalEvents(contract: string) {
    return this.db.getErc20ApprovalEvents({ contract });
  }

  getErc721TransferEvents(contract: string) {
    return this.db.getErc721TransferEvents({ contract });
  }

  getErc721ApprovalEvents(contract: string) {
    return this.db.getErc721ApprovalEvents({ contract });
  }

  getErc721ApprovalForAllEvents(contract: string) {
    return this.db.getErc721ApprovalForAllEvents({ contract });
  }

  getErc1155TransferSingleEvents(contract: string) {
    return this.db.getErc1155TransferSingleEvents({ contract });
  }

  getErc1155TransferBatchEvents(contract: string) {
    return this.db.getErc1155TransferBatchEvents({ contract });
  }

  getErc1155ApprovalForAllEvents(contract: string) {
    return this.db.getErc1155ApprovalForAllEvents({ contract });
  }
}

export default DataStorage;
