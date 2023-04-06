import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';

import DataStorage from '../storage';
import { SimplifiedTransaction, TokenContract, TokenStandard } from '../types';

const sum = (arr: (string | BigNumber)[]) =>
  arr.reduce((acc: BigNumber, curr) => acc.plus(curr), new BigNumber(0));

class DataTransformer {
  constructor(private storage: DataStorage) {}

  balanceByAccount(token: TokenContract) {
    const balanceByAccount = new Map<string, BigNumber>();

    if (token.type === TokenStandard.Erc20) {
      const transferEvents = this.storage.erc20TransferEventsByToken.get(token.address) || [];

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
      const transferEvents = this.storage.erc721TransferEventsByToken.get(token.address) || [];

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
      const transferSingleEvents =
        this.storage.erc1155TransferSingleEventsByToken.get(token.address) || [];
      const transferBatchEvents =
        this.storage.erc1155TransferBatchEventsByToken.get(token.address) || [];

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

  transactions(token: TokenContract) {
    const transactionSet = new Set<SimplifiedTransaction>();

    const directTransactions = this.storage.transactionsByToken.get(token.address) || [];
    directTransactions.forEach((t) => transactionSet.add(t));

    // Events in a token contract are not always triggered by transactions directly to the contract
    if (token.type === TokenStandard.Erc20) {
      const transferEvents = this.storage.erc20TransferEventsByToken.get(token.address) || [];
      const approvalEvents = this.storage.erc20ApprovalEventsByToken.get(token.address) || [];
      transferEvents.forEach((e) => transactionSet.add(e.transaction));
      approvalEvents.forEach((e) => transactionSet.add(e.transaction));
    } else if (token.type === TokenStandard.Erc721) {
      const transferEvents = this.storage.erc721TransferEventsByToken.get(token.address) || [];
      const approvalEvents = this.storage.erc721ApprovalEventsByToken.get(token.address) || [];
      const approvalForAllEvents =
        this.storage.erc721ApprovalForAllEventsByToken.get(token.address) || [];
      transferEvents.forEach((e) => transactionSet.add(e.transaction));
      approvalEvents.forEach((e) => transactionSet.add(e.transaction));
      approvalForAllEvents.forEach((e) => transactionSet.add(e.transaction));
    } else if (token.type === TokenStandard.Erc1155) {
      const transferSingleEvents =
        this.storage.erc1155TransferSingleEventsByToken.get(token.address) || [];
      const transferBatchEvents =
        this.storage.erc1155TransferBatchEventsByToken.get(token.address) || [];
      const approvalForAllEvents =
        this.storage.erc1155ApprovalForAllEventsByToken.get(token.address) || [];
      transferSingleEvents.forEach((e) => transactionSet.add(e.transaction));
      transferBatchEvents.forEach((e) => transactionSet.add(e.transaction));
      approvalForAllEvents.forEach((e) => transactionSet.add(e.transaction));
    }

    return transactionSet;
  }
}

export default DataTransformer;
