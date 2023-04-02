import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';

import DataStorage from '../storage';
import { TokenContract, TokenStandard } from '../types';

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
          fromBalance = fromBalance.minus(event.value);
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(event.value);
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
          fromBalance = fromBalance.minus(event.value);
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(event.value);
          balanceByAccount.set(event.to, toBalance);
        }
      }

      for (const event of transferBatchEvents) {
        if (event.from !== ethers.constants.AddressZero) {
          let fromBalance = balanceByAccount.get(event.from) || new BigNumber(0);
          fromBalance = fromBalance.minus(sum(event.values));
          balanceByAccount.set(event.from, fromBalance);
        }
        if (event.to !== ethers.constants.AddressZero) {
          let toBalance = balanceByAccount.get(event.to) || new BigNumber(0);
          toBalance = toBalance.plus(sum(event.values));
          balanceByAccount.set(event.to, toBalance);
        }
      }
    }

    return balanceByAccount;
  }
}

export default DataTransformer;
