import { BigNumber } from 'ethers';
import { TransactionEvent } from 'forta-agent';

import {
  Erc1155ApprovalForAllEvent,
  Erc1155TransferBatchEvent,
  Erc1155TransferSingleEvent,
  Erc20ApprovalEvent,
  Erc20TransferEvent,
  Erc721ApprovalEvent,
  Erc721ApprovalForAllEvent,
  Erc721TransferEvent,
  SimplifiedTransaction,
  TokenContract,
  TokenEvent,
} from './types';
import { erc1155Iface, erc20Iface, erc721Iface } from './contants';

class DataStorage {
  public tokenByAddress = new Map<string, TokenContract>();
  public transactionsByToken = new Map<string, Set<SimplifiedTransaction>>();
  public erc20TransferEventsByToken = new Map<string, Set<Erc20TransferEvent>>();
  public erc20ApprovalEventsByToken = new Map<string, Set<Erc20ApprovalEvent>>();
  public erc721TransferEventsByToken = new Map<string, Set<Erc721TransferEvent>>();
  public erc721ApprovalEventsByToken = new Map<string, Set<Erc721ApprovalEvent>>();
  public erc721ApprovalForAllEventsByToken = new Map<string, Set<Erc721ApprovalForAllEvent>>();
  public erc1155TransferSingleEventsByToken = new Map<string, Set<Erc1155TransferSingleEvent>>();
  public erc1155TransferBatchEventsByToken = new Map<string, Set<Erc1155TransferBatchEvent>>();
  public erc1155ApprovalForAllEventsByToken = new Map<string, Set<Erc1155ApprovalForAllEvent>>();

  constructor() {}

  add(txEvent: TransactionEvent) {
    const transaction: SimplifiedTransaction = {
      hash: txEvent.hash,
      from: txEvent.from,
      to: txEvent.to,
      timestamp: txEvent.timestamp,
    };

    const appendTransaction = (tokenAddr: string) => {
      let transactionSet = this.transactionsByToken.get(tokenAddr);
      if (!transactionSet) {
        transactionSet = new Set();
        this.transactionsByToken.set(tokenAddr, transactionSet);
      }
      transactionSet.add(transaction);
    };

    const appendEvent = <P extends TokenEvent>(key: string, map: Map<string, Set<P>>, event: P) => {
      let eventSet = map.get(key);
      if (!eventSet) {
        eventSet = new Set();
        map.set(key, eventSet);
      }
      eventSet.add(event);
    };

    const logs = txEvent.logs.filter((l) => this.tokenByAddress.has(l.address.toLowerCase()));

    if (txEvent.to && this.tokenByAddress.has(txEvent.to.toLowerCase())) {
      appendTransaction(txEvent.to.toLowerCase());
    }

    for (const log of logs) {
      const contractAddress = log.address.toLowerCase();

      appendTransaction(contractAddress);

      try {
        const parsedErc20Log = erc20Iface.parseLog(log);
        if (parsedErc20Log.name === 'Transfer') {
          const { from, to, value } = parsedErc20Log.args;
          appendEvent(contractAddress, this.erc20TransferEventsByToken, {
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            value: value.toString(),
            transaction: transaction,
          });
        } else if (parsedErc20Log.name === 'Approval') {
          const { owner, spender, value } = parsedErc20Log.args;
          appendEvent(contractAddress, this.erc20ApprovalEventsByToken, {
            owner: owner.toLowerCase(),
            spender: spender.toLowerCase(),
            value: value.toString(),
            transaction: transaction,
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
          appendEvent(contractAddress, this.erc721TransferEventsByToken, {
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            tokenId: tokenId,
            transaction: transaction,
          });
        } else if (parsedErc721Log.name === 'Approval') {
          const { owner, approved, tokenId } = parsedErc721Log.args;
          appendEvent(contractAddress, this.erc721ApprovalEventsByToken, {
            owner: owner.toLowerCase(),
            approved: approved.toLowerCase(),
            tokenId: tokenId,
            transaction: transaction,
          });
        } else if (parsedErc721Log.name === 'ApprovalForAll') {
          const { owner, operator, approved } = parsedErc721Log.args;
          appendEvent(contractAddress, this.erc721ApprovalForAllEventsByToken, {
            owner: owner.toLowerCase(),
            operator: operator.toLowerCase(),
            approved: approved,
            transaction: transaction,
          });
        }

        continue;
      } catch {
        // ignore
      }

      try {
        const parsedErc1155Log = erc1155Iface.parseLog(log);

        if (parsedErc1155Log.name === 'TransferSingle') {
          const { operator, from, to, tokenId, value } = parsedErc1155Log.args;
          appendEvent(contractAddress, this.erc1155TransferSingleEventsByToken, {
            operator: operator.toLowerCase(),
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            tokenId: tokenId,
            value: value.toString(),
            transaction: transaction,
          });
        } else if (parsedErc1155Log.name === 'TransferBatch') {
          const { operator, from, to, ids } = parsedErc1155Log.args;
          appendEvent(contractAddress, this.erc1155TransferBatchEventsByToken, {
            operator: operator.toLowerCase(),
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            ids: ids.map((id: BigNumber) => id.toString()),
            values: parsedErc1155Log.args[4].map((v: BigNumber) => v.toString()),
            transaction: transaction,
          });
        } else if (parsedErc1155Log.name === 'ApprovalForAll') {
          const { owner, operator, approved } = parsedErc1155Log.args;
          appendEvent(contractAddress, this.erc1155ApprovalForAllEventsByToken, {
            owner: owner.toLowerCase(),
            operator: operator.toLowerCase(),
            approved: approved,
            transaction: transaction,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  delete(tokenAddress: string) {
    this.tokenByAddress.delete(tokenAddress);
    this.transactionsByToken.delete(tokenAddress);
    this.erc721TransferEventsByToken.delete(tokenAddress);
    this.erc721ApprovalEventsByToken.delete(tokenAddress);
    this.erc721ApprovalForAllEventsByToken.delete(tokenAddress);
    this.erc1155TransferSingleEventsByToken.delete(tokenAddress);
    this.erc1155TransferBatchEventsByToken.delete(tokenAddress);
    this.erc1155ApprovalForAllEventsByToken.delete(tokenAddress);
  }
}

export default DataStorage;
