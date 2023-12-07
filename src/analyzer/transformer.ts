import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';

import DataStorage from '../storage';
import { SimplifiedTransaction, TokenContract, TokenStandard } from '../types';

const sum = (arr: (string | BigNumber)[]) =>
  arr.reduce((acc: BigNumber, curr) => acc.plus(curr), new BigNumber(0));

class DataTransformer {
  constructor(private storage: DataStorage) {}

  async balanceByAccount(token: TokenContract) {
    const balanceByAccount = new Map<string, BigNumber>();

    if (token.type === TokenStandard.Erc20) {
      const transferEvents = await this.storage.getErc20TransferEvents(token.address);

      for (const event of transferEvents) {
        if (event.from !== ethers.constants.AddressZero) {
          let fromBalance = balanceByAccount.get(event.from) || new BigNumber(0);
          fromBalance = fromBalance.minus(event.value.toString());
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(event.value.toString());
          balanceByAccount.set(event.to, toBalance);
        }
      }
    } else if (token.type === TokenStandard.Erc721) {
      const transferEvents = await this.storage.getErc721TransferEvents(token.address);

      for (const event of transferEvents) {
        if (event.from !== ethers.constants.AddressZero) {
          let fromBalance = balanceByAccount.get(event.from) || new BigNumber(0);
          fromBalance = fromBalance.minus(1);
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(1);
          balanceByAccount.set(event.to, toBalance);
        }
      }
    } else if (token.type === TokenStandard.Erc1155) {
      const transferSingleEvents = await this.storage.getErc1155TransferSingleEvents(token.address);
      const transferBatchEvents = await this.storage.getErc1155TransferBatchEvents(token.address);

      for (const event of transferSingleEvents) {
        if (event.from !== ethers.constants.AddressZero) {
          let fromBalance = balanceByAccount.get(event.from) || new BigNumber(0);
          fromBalance = fromBalance.minus(event.value.toString());
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(event.value.toString());
          balanceByAccount.set(event.to, toBalance);
        }
      }

      for (const event of transferBatchEvents) {
        if (event.from !== ethers.constants.AddressZero) {
          let fromBalance = balanceByAccount.get(event.from) || new BigNumber(0);
          fromBalance = fromBalance.minus(sum(event.values.map((v) => v.toString())));
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(sum(event.values.map((v) => v.toString())));
          balanceByAccount.set(event.to, toBalance);
        }
      }
    }

    return balanceByAccount;
  }

  async transactions(token: TokenContract) {
    const transactionSet = new Set<SimplifiedTransaction>();

    for (const transaction of await this.storage.getTransactions(token.address)) {
      transactionSet.add(transaction);
    }

    // Events in a token contract are not always triggered by transactions directly to the contract
    if (token.type === TokenStandard.Erc20) {
      for (const e of await this.storage.getErc20TransferEvents(token.address)) {
        transactionSet.add(e.transaction);
      }
      for (const e of await this.storage.getErc20ApprovalEvents(token.address)) {
        transactionSet.add(e.transaction);
      }
    } else if (token.type === TokenStandard.Erc721) {
      for (const e of await this.storage.getErc721TransferEvents(token.address)) {
        transactionSet.add(e.transaction);
      }
      for (const e of await this.storage.getErc721ApprovalEvents(token.address)) {
        transactionSet.add(e.transaction);
      }
      for (const e of await this.storage.getErc721ApprovalForAllEvents(token.address)) {
        transactionSet.add(e.transaction);
      }
    } else if (token.type === TokenStandard.Erc1155) {
      for (const e of await this.storage.getErc1155TransferSingleEvents(token.address)) {
        transactionSet.add(e.transaction);
      }
      for (const e of await this.storage.getErc1155TransferBatchEvents(token.address)) {
        transactionSet.add(e.transaction);
      }
      for (const e of await this.storage.getErc1155ApprovalForAllEvents(token.address)) {
        transactionSet.add(e.transaction);
      }
    }

    return transactionSet;
  }
}

export default DataTransformer;
