export type DuneEvent = {
  tx_from: string;
  tx_to: string;
  tx_hash: string;
  timestamp: number;
  block_number: number;
  contract: string;
};

export type Erc20TransferEvent = DuneEvent & {
  from: string;
  to: string;
  value: string;
};

export type Erc20ApprovalEvent = DuneEvent & {
  owner: string;
  spender: string;
  value: string;
};

export type Erc721TransferEvent = DuneEvent & {
  from: string;
  to: string;
  token_id: string;
};

export type Erc721ApprovalEvent = DuneEvent & {
  owner: string;
  approved: string;
  token_id: string;
};

export type Erc721ApprovalForAllEvent = DuneEvent & {
  owner: string;
  operator: string;
  approved: boolean;
};

export type Erc1155TransferSingleEvent = DuneEvent & {
  operator: string;
  from: string;
  to: string;
  token_id: string;
  value: string;
};

export type Erc1155TransferBatchEvent = DuneEvent & {
  operator: string;
  from: string;
  to: string;
  token_ids: string;
  token_values: string;
};

export type Erc1155ApprovalForAllEvent = DuneEvent & {
  owner: string;
  operator: string;
  approved: boolean;
};
