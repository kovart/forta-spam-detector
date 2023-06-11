import { Block } from 'forta-agent';
import { providers } from 'ethers';
import { BotSharding } from 'forta-sharding';

import { SpamDetector } from './detector';
import { AnalysisResult } from './analyzer/types';

export type DataContainer = {
  provider: providers.JsonRpcProvider;
  detector: SpamDetector;
  sharding: BotSharding;
  analysisByToken: Map<TokenContract, AnalysisResult>;
  previousBlock: Block;
  isInitialized: boolean;
  isDevelopment: boolean;
};

export enum TokenStandard {
  Erc20 = 20,
  Erc721 = 721,
  Erc1155 = 1155,
}

export type CreatedContract = {
  deployer: string;
  address: string;
  timestamp: number;
  blockNumber: number;
};

export type TokenContract = CreatedContract & {
  type: TokenStandard;
};

export type SimplifiedTransaction = {
  from: string;
  to: string | null;
  sighash: string;
  timestamp: number;
  blockNumber: number;
  hash: string;
  index: number;
};

export type TokenEvent = {
  transaction: SimplifiedTransaction;
  contract: string;
  logIndex: number;
};

export type Erc20TransferEvent = {
  from: string;
  to: string;
  value: BigInt;
};

export type DetailedErc20TransferEvent = TokenEvent & Erc20TransferEvent;

export type Erc20ApprovalEvent = {
  owner: string;
  spender: string;
  value: BigInt;
};

export type DetailedErc20ApprovalEvent = TokenEvent & Erc20ApprovalEvent;

export type Erc721TransferEvent = {
  from: string;
  to: string;
  tokenId: string;
};

export type DetailedErc721TransferEvent = TokenEvent & Erc721TransferEvent;

export type Erc721ApprovalEvent = {
  owner: string;
  approved: string;
  tokenId: string;
};

export type DetailedErc721ApprovalEvent = TokenEvent & Erc721ApprovalEvent;

export type Erc721ApprovalForAllEvent = {
  owner: string;
  operator: string;
  approved: boolean;
};

export type DetailedErc721ApprovalForAllEvent = TokenEvent & Erc721ApprovalForAllEvent;

export type Erc1155TransferSingleEvent = {
  operator: string;
  from: string;
  to: string;
  tokenId: string;
  value: BigInt;
};

export type DetailedErc1155TransferSingleEvent = TokenEvent & Erc1155TransferSingleEvent;

export type Erc1155TransferBatchEvent = {
  operator: string;
  from: string;
  to: string;
  ids: string[];
  values: BigInt[];
};
export type DetailedErc1155TransferBatchEvent = TokenEvent & Erc1155TransferBatchEvent;

export type Erc1155ApprovalForAllEvent = {
  owner: string;
  operator: string;
  approved: boolean;
};

export type DetailedErc1155ApprovalForAllEvent = TokenEvent & Erc1155ApprovalForAllEvent;
