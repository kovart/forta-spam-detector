import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
// @ts-ignore
import { Dune } from 'dune-ts/dist/cjs/index.js';
import { createTransactionEvent, EventType, Log, TransactionEvent } from 'forta-agent';

import {
  DuneEvent,
  Erc1155ApprovalForAllEvent,
  Erc1155TransferBatchEvent,
  Erc1155TransferSingleEvent,
  Erc20ApprovalEvent,
  Erc20TransferEvent,
  Erc721ApprovalEvent,
  Erc721ApprovalForAllEvent,
  Erc721TransferEvent,
  LogRow,
  Token,
  TransactionRow,
} from './types';
import { CACHE_DIRECTORY, DUNE_USERS, QUERIES_DIRECTORY } from './contants';
import { CsvStorage } from '../../src/utils/storage';
import { erc1155Iface, erc20Iface, erc721Iface } from '../../src/contants';
import { TokenStandard } from '../../src/types';
import { DUNE_NETWORK_BY_NETWORK } from '../constants';

const DUNE_USER = DUNE_USERS[0];
const QUERY_ID = 2355289;
const DATA_INTERVAL = 4 * 31 * 24 * 60 * 60; // 4 months

const readSqlFile = (name: string) =>
  fs.readFileSync(path.resolve(QUERIES_DIRECTORY, name), {
    encoding: 'utf-8',
  });

const getTransactionStorage = (address: string) =>
  new CsvStorage<TransactionRow>(
    CACHE_DIRECTORY,
    `${address}-transactions.csv`,
    (v) => ({
      ...v,
      timestamp: Number(v.timestamp),
      block_number: Number(v.block_number),
      index: Number(v.index),
    }),
    (v) => v,
  );

const getLogStorage = (address: string) =>
  new CsvStorage<LogRow>(
    CACHE_DIRECTORY,
    `${address}-logs.csv`,
    (v) => ({ ...v, index: Number(v.index), topics: v.topics.split(',') }),
    (v) => ({ ...v, topics: v.topics.join(',') }),
  );

const prepareEventQuery = (token: Token, queryStr: string) => {
  queryStr = queryStr
    .replace('{{network}}', DUNE_NETWORK_BY_NETWORK[token.network])
    .replace(
      '{{whereFilter}}',
      `evt.contract_address = ${token.address} AND evt."evt_block_time" < timestamp '${dayjs
        .unix(token.timestamp)
        .add(DATA_INTERVAL)
        .format('YYYY-MM-DD HH:mm')}')`,
    );
  return queryStr;
};

const normalizeAddress = (addr: string) => addr.toLowerCase();

function createTxEvent(token: Token, tx: TransactionRow, logs: Log[] = []) {
  return createTransactionEvent({
    type: EventType.BLOCK,
    network: token.network,
    logs: logs,
    block: {
      timestamp: tx.timestamp,
      number: tx.block_number,
      hash: tx.hash,
    },
    traces: [],
    transaction: {
      from: tx.from,
      to: tx.to,
      hash: tx.hash,
      // we do not store this data
      value: '0x',
      data: '0x',
      v: '',
      s: '',
      r: '',
      gas: '',
      nonce: 1,
      gasPrice: '0x0',
    },
    contractAddress: null,
    addresses: {},
  });
}

export async function fetchTransactions(token: Token) {
  console.log('Fetching transactions...');

  const storage = getTransactionStorage(token.address);

  if (await storage.exists()) {
    return await storage.read();
  }

  const dune = new Dune({ username: DUNE_USER[0], password: DUNE_USER[1] });
  await dune.login();

  let query = readSqlFile('transactions.sql');

  query = query.replace('{{whereFilter}}', `tx.to = ${token.address}`);
  query = query.replace('{{network}}', DUNE_NETWORK_BY_NETWORK[token.network]);

  const { data } = await dune.query(QUERY_ID, [{ type: 'text', key: 'query', value: query }]);

  await storage.write(data);

  return data as TransactionRow[];
}

export async function fetchLogs(token: Token, transactions: TransactionRow[]) {
  console.log('Fetching logs...');

  const logStorage = getLogStorage(token.address);

  const transactionByHash = new Map<string, TransactionRow>(transactions.map((t) => [t.hash, t]));

  if (await logStorage.exists()) {
    const logs = await logStorage.read();

    return { logSet: new Set(logs), transactionSet: new Set(transactions) };
  }

  const dune = new Dune({ username: DUNE_USER[0], password: DUNE_USER[1] });
  await dune.login();
  const logSet = new Set<LogRow>();

  const processors: {
    query: string;
    encode: (event: any) => { data: string; topics: string[] };
  }[] = [];

  if (token.type === TokenStandard.Erc20) {
    processors.push(
      {
        query: readSqlFile('erc20-transfer.sql'),
        encode: (e: Erc20TransferEvent) =>
          erc20Iface.encodeEventLog('Transfer', [e.from, e.to, e.value]),
      },
      {
        query: readSqlFile('erc20-approval.sql'),
        encode: (e: Erc20ApprovalEvent) =>
          erc20Iface.encodeEventLog('Approval', [e.owner, e.spender, e.value]),
      },
    );
  } else if (token.type === TokenStandard.Erc721) {
    processors.push(
      {
        query: readSqlFile('erc721-transfer.sql'),
        encode: (e: Erc721TransferEvent) =>
          erc721Iface.encodeEventLog('Transfer', [e.from, e.to, e.token_id]),
      },
      {
        query: readSqlFile('erc72-approval.sql'),
        encode: (e: Erc721ApprovalEvent) =>
          erc721Iface.encodeEventLog('Approval', [e.owner, e.approved, e.token_id]),
      },
      {
        query: readSqlFile('erc72-approval.sql'),
        encode: (e: Erc721ApprovalForAllEvent) =>
          erc721Iface.encodeEventLog('ApprovalForAll', [e.owner, e.operator, e.approved]),
      },
    );
  } else if (token.type === TokenStandard.Erc1155) {
    processors.push(
      {
        query: readSqlFile('erc1155-transfer-single.sql'),
        encode: (e: Erc1155TransferSingleEvent) =>
          erc1155Iface.encodeEventLog('TransferSingle', [
            normalizeAddress(e.operator),
            normalizeAddress(e.from),
            normalizeAddress(e.to),
            e.token_id,
            e.value,
          ]),
      },
      {
        query: readSqlFile('erc1155-transfer-batch.sql'),
        encode: (e: Erc1155TransferBatchEvent) =>
          erc1155Iface.encodeEventLog('TransferBatch', [
            normalizeAddress(e.operator),
            normalizeAddress(e.from),
            normalizeAddress(e.to),
            e.token_ids.split(','),
            e.token_values.split(','),
          ]),
      },
      {
        query: readSqlFile('erc1155-approval-for-all.sql'),
        encode: (e: Erc1155ApprovalForAllEvent) =>
          erc1155Iface.encodeEventLog('ApprovalForAll', [
            normalizeAddress(e.owner),
            normalizeAddress(e.operator),
            e.approved,
          ]),
      },
    );
  } else {
    throw new Error(`Unknown token type: ${token.type}`);
  }

  for (const processor of processors) {
    const { encode, query } = processor;

    const dune = new Dune({ username: DUNE_USER[0], password: DUNE_USER[1] });
    await dune.login();
    const { data: events } = await dune.query(QUERY_ID, [
      { key: 'query', type: 'text', value: prepareEventQuery(token, query) },
    ]);

    for (const event of events as DuneEvent[]) {
      const { data, topics } = encode(event);
      if (!transactionByHash.has(event.tx_hash)) {
        transactionByHash.set(event.tx_hash, {
          from: event.tx_from,
          to: event.tx_to,
          block_number: event.block_number,
          timestamp: event.block_number,
          index: event.tx_index,
          hash: event.tx_hash,
        });
      }
      logSet.add({
        data,
        topics,
        index: event.index,
        tx_hash: event.tx_hash,
      });
    }
  }

  await getTransactionStorage(token.address).write([...transactionByHash.values()]);
  await logStorage.write([...logSet]);

  return { transactionSet: new Set(transactionByHash.values()), logSet };
}

export async function getTxEvents(token: Token) {
  const transactions = await fetchTransactions(token);
  const { transactionSet, logSet } = await fetchLogs(token, transactions);

  console.log('Data has successfully fetched');

  const logsByTxHash = new Map<string, Set<Log>>();

  for (const log of logSet) {
    let logSet = logsByTxHash.get(log.tx_hash);
    if (!logSet) {
      logSet = new Set();
      logsByTxHash.set(log.tx_hash, logSet);
    }
    logSet.add({
      data: log.data,
      topics: log.topics,
      logIndex: log.index,
      transactionHash: log.tx_hash,
    } as Log);
  }

  const txEvent: TransactionEvent[] = [];

  for (const transaction of transactionSet) {
    const logSet = logsByTxHash.get(transaction.hash) || new Set();
    txEvent.push(createTxEvent(token, transaction, [...logSet]));
  }

  txEvent.sort((e1, e2) => e1.timestamp - e2.timestamp);

  return txEvent;
}

export async function getBlocks(token: Token) {
  const txEvents = await getTxEvents(token);

  type Block = { number: number; timestamp: number; txEvents: TransactionEvent[] };

  const blocks: Block[] = [];

  let prevBlock: Block | undefined = undefined;
  for (const txEvent of txEvents) {
    let block: Block | undefined = prevBlock;

    if (!block || prevBlock?.number === txEvent.blockNumber) {
      block = {
        number: txEvent.blockNumber,
        timestamp: txEvent.timestamp,
        txEvents: [],
      };
    }

    block.txEvents.push(txEvent);
    blocks.push(block);

    prevBlock = block;
  }

  return blocks;
}
