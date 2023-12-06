import {
  DetailedErc1155ApprovalForAllEvent,
  DetailedErc1155TransferBatchEvent,
  DetailedErc1155TransferSingleEvent,
  DetailedErc20ApprovalEvent,
  DetailedErc20TransferEvent,
  DetailedErc721ApprovalEvent,
  DetailedErc721ApprovalForAllEvent,
  DetailedErc721TransferEvent,
  SimplifiedTransaction,
  TokenContract,
} from '../types';
import { TokenInsertEvent } from './database';

export interface ISqlDatabase {
  initialize(): Promise<void>;
  getTokens(): Promise<TokenContract[]>;
  getTransactions(params: { to: string | null }): Promise<SimplifiedTransaction[]>;
  getErc20ApprovalEvents(params: { contract: string }): Promise<DetailedErc20ApprovalEvent[]>;
  getErc20TransferEvents(params: { contract: string }): Promise<DetailedErc20TransferEvent[]>;
  getErc721ApprovalEvents(params: { contract: string }): Promise<DetailedErc721ApprovalEvent[]>;
  getErc721TransferEvents(params: { contract: string }): Promise<DetailedErc721TransferEvent[]>;
  getErc721ApprovalForAllEvents(params: {
    contract: string;
  }): Promise<DetailedErc721ApprovalForAllEvent[]>;
  getErc1155ApprovalForAllEvents(params: {
    contract: string;
  }): Promise<DetailedErc1155ApprovalForAllEvent[]>;
  getErc1155TransferSingleEvents(params: {
    contract: string;
  }): Promise<DetailedErc1155TransferSingleEvent[]>;
  getErc1155TransferBatchEvents(params: {
    contract: string;
  }): Promise<DetailedErc1155TransferBatchEvent[]>;
  addToken(token: TokenContract): void;
  addTransaction(tx: SimplifiedTransaction): Promise<number>;
  addErc20ApprovalEvent(event: TokenInsertEvent<DetailedErc20ApprovalEvent>): Promise<void>;
  addErc20TransferEvent(event: TokenInsertEvent<DetailedErc20TransferEvent>): Promise<void>;
  addErc721ApprovalEvent(event: TokenInsertEvent<DetailedErc721ApprovalEvent>): Promise<void>;
  addErc721TransferEvent(event: TokenInsertEvent<DetailedErc721TransferEvent>): Promise<void>;
  addErc721ApprovalForAllEvent(
    event: TokenInsertEvent<DetailedErc721ApprovalForAllEvent>,
  ): Promise<void>;
  addErc1155ApprovalForAllEvent(
    event: TokenInsertEvent<DetailedErc1155ApprovalForAllEvent>,
  ): Promise<void>;
  addErc1155TransferSingleEvent(
    event: TokenInsertEvent<DetailedErc1155TransferSingleEvent>,
  ): Promise<void>;
  addErc1155TransferBatchEvent(
    event: TokenInsertEvent<DetailedErc1155TransferBatchEvent>,
  ): Promise<void>;
  clearToken(address: string): void;
  close(cb: ((err: Error | null) => void) | undefined): Promise<unknown>;
  wait(): Promise<unknown>;
  run(query: string, ...params: any[]): Promise<unknown>;
  exec(query: string, ...params: any[]): Promise<unknown>;
}
