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
};

export type TokenEvent = {
  transaction: SimplifiedTransaction;
  contract: string;
};

export type Erc20TransferEvent = TokenEvent & {
  from: string;
  to: string;
  value: BigInt;
};

export type Erc20ApprovalEvent = TokenEvent & {
  owner: string;
  spender: string;
  value: BigInt;
};

export type Erc721TransferEvent = TokenEvent & {
  from: string;
  to: string;
  tokenId: string;
};

export type Erc721ApprovalEvent = TokenEvent & {
  owner: string;
  approved: string;
  tokenId: string;
};

export type Erc721ApprovalForAllEvent = TokenEvent & {
  owner: string;
  operator: string;
  approved: boolean;
};

export type Erc1155TransferSingleEvent = TokenEvent & {
  operator: string;
  from: string;
  to: string;
  tokenId: string;
  value: BigInt;
};

export type Erc1155TransferBatchEvent = TokenEvent & {
  operator: string;
  from: string;
  to: string;
  ids: string[];
  values: BigInt[];
};

export type Erc1155ApprovalForAllEvent = TokenEvent & {
  owner: string;
  operator: string;
  approved: boolean;
};
