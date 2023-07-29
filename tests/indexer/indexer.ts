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
} from '../../src/types';

export type IndexerInterval = {
  startDate?: number;
  endDate?: number;
};

export type IndexerEvent<T> = T & {
  contract: string;
  logIndex: number;
  transactionHash: string;
};

export interface IBlockchainIndexer {
  getTransactionsByContract(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<SimplifiedTransaction[]>;
  getTransactionsByHashes(
    params: { hashes: string[] } & IndexerInterval,
    config: { limit: number },
  ): Promise<SimplifiedTransaction[]>;

  getErc20TransferEvents(
    params: { contract?: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc20TransferEvent>[]>;

  getErc20ApprovalEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc20ApprovalEvent>[]>;

  getErc721TransferEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc721TransferEvent>[]>;

  getErc721ApprovalEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc721ApprovalEvent>[]>;

  getErc721ApprovalForAllEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc721ApprovalForAllEvent>[]>;

  getErc1155TransferSingleEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc1155TransferSingleEvent>[]>;

  getErc1155TransferBatchEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc1155TransferBatchEvent>[]>;

  getErc1155ApprovalForAllEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc1155ApprovalForAllEvent>[]>;

  getErc20Contracts(interval: IndexerInterval): Promise<TokenContract[]>;
  getErc721Contracts(interval: IndexerInterval): Promise<TokenContract[]>;
  getErc1155Contracts(interval: IndexerInterval): Promise<TokenContract[]>;
}
