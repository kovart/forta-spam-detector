import { Network } from 'forta-agent';
import { providers } from 'ethers';

import { SpamDetector } from './detector';

import { AnalysisContext } from './analyzer/types';

export type DataContainer = {
  provider: providers.JsonRpcProvider;
  detector: SpamDetector;
  analysisByToken: Map<TokenContract, AnalysisContext>;
  network: Network;
  isInitialized: boolean;
  isDevelopment: boolean;
  isDebug: boolean;
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
  timestamp: number;
  blockNumber: number;
  hash: string;
};

export type TokenEvent = {
  transaction: SimplifiedTransaction;
};

export type Erc20TransferEvent = TokenEvent & {
  from: string;
  to: string;
  value: string;
};

export type Erc20ApprovalEvent = TokenEvent & {
  owner: string;
  spender: string;
  value: string;
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
  value: string;
};

export type Erc1155TransferBatchEvent = TokenEvent & {
  operator: string;
  from: string;
  to: string;
  ids: string[];
  values: string[];
};

export type Erc1155ApprovalForAllEvent = TokenEvent & {
  owner: string;
  operator: string;
  approved: boolean;
};
