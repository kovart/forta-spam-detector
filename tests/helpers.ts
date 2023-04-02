import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import { chunk } from 'lodash';
import { createTransactionEvent, EventType, Log, Network, TransactionEvent } from 'forta-agent';

import Database from './utils/database';
import { SimplifiedTransaction, TokenStandard } from '../src/types';
import { getTestTokenStorage, TokenRecord } from './utils/storages';
import {
  Erc20ApprovalEvent,
  Erc20TransferEvent,
  Erc721ApprovalEvent,
  Erc721TransferEvent,
} from './scripts/types';
import { erc20Iface, erc721Iface } from '../src/contants';

dayjs.extend(duration);

const MAX_NUMBER_OF_INLINE_VALUES = 999;

const getTxHash = (tx: SimplifiedTransaction) => `0x${tx.hash}${tx.blockNumber}${tx.timestamp}`;

export const formatDate = (timestamp: number) => dayjs.unix(timestamp).format('DD-MM-YYYY HH:mm');

export const formatDuration = (timestamp: number) =>
  dayjs.duration(timestamp, 'second').format('DD[d] HH[h]:mm[m]:ss[s]');

function createLog(
  address: string,
  tx: SimplifiedTransaction,
  encodedData: { topics: string[]; data: string },
): Log {
  return {
    address: address,
    data: encodedData.data,
    topics: encodedData.topics,
    blockNumber: tx.blockNumber,
    transactionHash: getTxHash(tx),

    // we do not currently use this data
    blockHash: `0x${tx.blockNumber}`,
    transactionIndex: tx.blockNumber,
    removed: false,
    logIndex: 0,
  };
}

function createTxEvent(tx: SimplifiedTransaction, logs: Log[] = []) {
  return createTransactionEvent({
    type: EventType.BLOCK,
    network: Network.MAINNET,
    logs: logs,
    block: {
      timestamp: tx.timestamp,
      number: tx.blockNumber,
      hash: `0x${tx.blockNumber}`,
    },
    traces: [],
    transaction: {
      from: tx.from,
      to: tx.to,
      // DB stores a reduced hash version
      hash: getTxHash(tx),
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

export async function readTokens() {
  const contracts = await Database.all<{ address: string; type: TokenStandard }>(`
    SELECT "address", "type" 
    FROM contracts c
        JOIN addresses a ON c.address_id = a.address_id
  `);

  if (!contracts) {
    throw new Error('Cannot read contracts from DB');
  }

  const tokens = await getTestTokenStorage(Network.MAINNET).read();
  const contractByAddress = new Map(contracts.map((c) => [c.address, c]));

  return tokens.filter((t) => contractByAddress.has(t.contract));
}

export async function getTxEvents(
  token: TokenRecord,
  eventList: {
    name: string;
    events: { transaction_id: string }[];
    encode: (e: any) => { data: any; topics: any[] };
  }[],
) {
  const transactionIds: string[] = eventList
    .map((t) => t.events.map((e) => e.transaction_id))
    .flat();

  type Tx = SimplifiedTransaction & { transaction_id: string };

  const transactionById = new Map<string, Tx>();
  for (const batch of chunk(transactionIds, MAX_NUMBER_OF_INLINE_VALUES)) {
    const transactions = await Database.all<Tx>(`
        SELECT t.transaction_id, t.block_number AS blockNumber, t.timestamp, t.transaction_hash AS "hash", from_a.address AS "from", to_a.address AS "to"
        FROM (
            SELECT *
            FROM transactions t
            WHERE t.transaction_id IN (${batch.join(',')})
        ) AS t
           JOIN addresses from_a ON from_a.address_id = t.from_id
           JOIN addresses to_a ON to_a.address_id = t.to_id
      `);

    transactions.forEach((t) => transactionById.set(t.transaction_id, t));
  }

  console.log(`Token (ERC${token.type}): ${token.contract}`);
  console.log(
    `Total transactions: ${transactionById.size}. ${eventList
      .map((e) => `${e.name} events: ${e.events.length}`)
      .join('. ')}`,
  );

  const maps = eventList.map((e) => new Map<string, Set<(typeof e.events)[0]>>());

  const append = <P, K>(map: Map<K, Set<P>>, key: K, event: P) => {
    let eventSet = map.get(key);
    if (!eventSet) {
      eventSet = new Set();
      map.set(key, eventSet);
    }
    eventSet.add(event);
  };

  eventList.forEach((e, i) => {
    e.events.forEach((e) => append(maps[i], e.transaction_id, e));
  });

  const sortedTransactions = [...transactionById.values()];
  sortedTransactions.sort((t1, t2) => t1.timestamp - t2.timestamp);

  const txEvents: TransactionEvent[] = [];
  for (const tx of sortedTransactions) {
    const eventSets = maps.map((m) => m.get(tx.transaction_id) || new Set());

    const txEvent = createTxEvent(tx, [
      ...[...eventSets]
        .map((set, i) => [...set].map((e) => createLog(token.contract, tx, eventList[i].encode(e))))
        .flat(),
    ]);

    txEvents.push(txEvent);
  }

  return txEvents;
}

export async function getErc20TxEvents(token: TokenRecord) {
  const transferEvents = await Database.all<any>(`
      SELECT *
      FROM (
          SELECT from_a.address AS "from", to_a.address AS "to", e.value, e.transaction_id, address_a.address AS "contract"
          FROM erc_20_transfer_events e 
              JOIN addresses from_a ON e.from_id = from_a.address_id
              JOIN addresses to_a ON e.to_id = to_a.address_id
              JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
              JOIN addresses address_a ON contract_a.address_id = address_a.address_id
      ) AS e
      WHERE e.contract = "${token.contract}"
    `);
  const approvalEvents = await Database.all<any>(`
      SELECT *
      FROM (
          SELECT owner_a.address AS "owner", spender_a.address AS "spender", e.value, e.transaction_id, address_a.address AS "contract"
          FROM erc_20_approval_events e 
              JOIN addresses owner_a ON e.owner_id = owner_a.address_id
              JOIN addresses spender_a ON e.spender_id = spender_a.address_id
              JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
              JOIN addresses address_a ON contract_a.address_id = address_a.address_id
      ) AS e
      WHERE e.contract = "${token.contract}"
    `);

  return getTxEvents(token, [
    {
      name: 'Transfer',
      events: transferEvents,
      encode: (e: Erc20TransferEvent) =>
        erc20Iface.encodeEventLog('Transfer', [e.from, e.to, e.value]),
    },
    {
      name: 'Approval',
      events: approvalEvents,
      encode: (e: Erc20ApprovalEvent) =>
        erc20Iface.encodeEventLog('Approval', [e.owner, e.spender, e.value]),
    },
  ]);
}

export async function getErc721TxEvents(token: TokenRecord) {
  const transferEvents = await Database.all<any>(`
      SELECT *
      FROM (
          SELECT from_a.address AS "from", to_a.address AS "to", e.transaction_id, e.token_id, address_a.address AS "contract"
          FROM erc_721_transfer_events e 
              JOIN addresses from_a ON e.from_id = from_a.address_id
              JOIN addresses to_a ON e.to_id = to_a.address_id
              JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
              JOIN addresses address_a ON contract_a.address_id = address_a.address_id
      ) AS e
      WHERE e.contract = "${token.contract}"
    `);
  const approvalEvents = await Database.all<any>(`
      SELECT *
      FROM (
          SELECT owner_a.address AS "owner", approved_a.address AS "approved", e.token_id, e.transaction_id, address_a.address AS "contract"
          FROM erc_721_approval_events e 
              JOIN addresses owner_a ON e.owner_id = owner_a.address_id
              JOIN addresses approved_a ON e.approved_id = approved_a.address_id
              JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
              JOIN addresses address_a ON contract_a.address_id = address_a.address_id
      ) AS e
      WHERE e.contract = "${token.contract}"
    `);

  // approvalForAll table is empty

  return getTxEvents(token, [
    {
      name: 'Transfer',
      events: transferEvents,
      encode: (e: Erc721TransferEvent) =>
        erc721Iface.encodeEventLog('Transfer', [e.from, e.to, e.token_id]),
    },
    {
      name: 'Approval',
      events: approvalEvents,
      encode: (e: Erc721ApprovalEvent) =>
        erc721Iface.encodeEventLog('Approval', [e.owner, e.approved, e.token_id]),
    },
  ]);
}

export function* generateBlocks(
  events: TransactionEvent[],
  startBlockNumber: number,
  startTimestamp: number,
  endTimestamp: number,
  interval = 3 * 60,
) {
  type Block = {
    timestamp: number;
    number: number;
    events: TransactionEvent[];
  };

  const totalBlocks = Math.floor((endTimestamp - startTimestamp) / interval);

  let blockCounter = 0;
  let prevEventIndex = 0;
  for (let timestamp = startTimestamp; timestamp <= endTimestamp; timestamp += interval) {
    const block: Block = {
      timestamp,
      number: startBlockNumber + blockCounter,
      events: [],
    };

    for (let i = prevEventIndex; i < events.length; i++) {
      const event = events[i];

      if (event.block.timestamp >= timestamp + interval) break;

      block.events.push(event);
      prevEventIndex = i;
      block.number = event.blockNumber;
    }

    yield {
      block,
      blockCounter: blockCounter,
      eventCounter: prevEventIndex,
      totalBlocks: totalBlocks,
    };

    blockCounter++;
  }
}
