import { ethers } from 'ethers';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import { chunk, groupBy } from 'lodash';
import { createTransactionEvent, EventType, Log, Network, TransactionEvent } from 'forta-agent';

import Database from './utils/database';
import { SimplifiedTransaction, TokenStandard } from '../../src/types';
import { getTestTokenStorage, TokenRecord } from './utils/storages';
import {
  Erc1155ApprovalForAllEvent,
  Erc1155TransferBatchEvent,
  Erc1155TransferSingleEvent,
  Erc20ApprovalEvent,
  Erc20TransferEvent,
  Erc721ApprovalEvent,
  Erc721TransferEvent,
} from './scripts/types';
import { erc1155Iface, erc20Iface, erc721Iface } from '../../src/contants';

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

  const eventMaps = eventList.map((e) => new Map<string, Set<(typeof e.events)[0]>>());

  const append = <P, K>(map: Map<K, Set<P>>, key: K, event: P) => {
    let eventSet = map.get(key);
    if (!eventSet) {
      eventSet = new Set();
      map.set(key, eventSet);
    }
    eventSet.add(event);
  };

  eventList.forEach((e, i) => {
    e.events.forEach((e) => append(eventMaps[i], e.transaction_id, e));
  });

  const sortedTransactions = [...transactionById.values()];
  sortedTransactions.sort((t1, t2) => t1.timestamp - t2.timestamp);

  const txEvents: TransactionEvent[] = [];
  for (const tx of sortedTransactions) {
    const eventSets = eventMaps.map((m) => m.get(tx.transaction_id) || new Set());

    const logs = [...eventSets]
      .map((eventSet, i) =>
        [...eventSet].map((e: any) => createLog(token.contract, tx, eventList[i].encode(e))),
      )
      .flat();

    const txEvent = createTxEvent(tx, logs);

    txEvents.push(txEvent);
  }

  return txEvents;
}

export async function getErc20TxEvents(token: TokenRecord) {
  const transferEvents = await Database.all<any>(`
      SELECT *
      FROM (
          SELECT e.event_id, from_a.address AS "from", to_a.address AS "to", e.value, e.transaction_id, address_a.address AS "contract"
          FROM erc_20_transfer_events e 
              JOIN addresses from_a ON e.from_id = from_a.address_id
              JOIN addresses to_a ON e.to_id = to_a.address_id
              JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
              JOIN addresses address_a ON contract_a.address_id = address_a.address_id
      ) AS e
      WHERE e.contract = "${token.contract}"
      ORDER BY e.event_id ASC
    `);
  const approvalEvents = await Database.all<any>(`
      SELECT *
      FROM (
          SELECT e.event_id, owner_a.address AS "owner", spender_a.address AS "spender", e.value, e.transaction_id, address_a.address AS "contract"
          FROM erc_20_approval_events e 
              JOIN addresses owner_a ON e.owner_id = owner_a.address_id
              JOIN addresses spender_a ON e.spender_id = spender_a.address_id
              JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
              JOIN addresses address_a ON contract_a.address_id = address_a.address_id
      ) AS e
      WHERE e.contract = "${token.contract}"
      ORDER BY e.event_id ASC
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
  let transferEvents = await Database.all<any>(`
      SELECT e.*, t.timestamp
      FROM (
        SELECT *
        FROM (
            SELECT e.event_id, from_a.address AS "from", to_a.address AS "to", e.transaction_id, e.token_id, address_a.address AS "contract"
            FROM erc_721_transfer_events e 
                JOIN addresses from_a ON e.from_id = from_a.address_id
                JOIN addresses to_a ON e.to_id = to_a.address_id
                JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
                JOIN addresses address_a ON contract_a.address_id = address_a.address_id
        ) AS e
        WHERE e.contract = "${token.contract}"
        ORDER BY e.event_id ASC
      ) AS e
      JOIN transactions t ON e.transaction_id = t.transaction_id 
    `);

  const approvalEvents = await Database.all<any>(`
      SELECT *
      FROM (
          SELECT e.event_id, owner_a.address AS "owner", approved_a.address AS "approved", e.token_id, e.transaction_id, address_a.address AS "contract"
          FROM erc_721_approval_events e 
              JOIN addresses owner_a ON e.owner_id = owner_a.address_id
              JOIN addresses approved_a ON e.approved_id = approved_a.address_id
              JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
              JOIN addresses address_a ON contract_a.address_id = address_a.address_id
      ) AS e
      WHERE e.contract = "${token.contract}"
      ORDER BY e.event_id ASC
    `);

  // approvalForAll table is empty

  // TODO Update test data to remove this fix
  // Unfortunately, when I fetched the data I missed to load the logIndex of events.
  // Without this data, the order of events may conflict, for example when the owner sends a token that he does not own yet.
  // This is a temporary fix for this issue.
  const transferGroups = groupBy(transferEvents, (e) => e.timestamp);
  for (const [timestamp, events] of Object.entries(transferGroups)) {
    const sortedEvents: typeof events = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Check if the transaction has already been added to the result
      if (sortedEvents.includes(event)) {
        continue;
      }

      // Check if the person from whom the token is sent has already received the token
      let index = sortedEvents.findIndex((e: any) => e.to === event.from);

      // If the person from whom the token is sent has not yet received the token,
      // move the token to the correct position in the result array
      while (
        index !== -1 &&
        index < sortedEvents.length - 1 &&
        sortedEvents[index + 1].from === event.to
      ) {
        index++;
      }

      // Insert the event at the correct position in the result array
      sortedEvents.splice(index + 1, 0, event);
    }

    transferGroups[timestamp] = sortedEvents;
  }

  const timestamps = Object.keys(transferGroups);
  timestamps.sort((a, b) => Number(a) - Number(b));

  transferEvents = [];
  for (const timestamp of timestamps) {
    const events = transferGroups[timestamp];
    transferEvents.push(...events);
  }

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

export async function getErc1155TxEvents(token: TokenRecord) {
  const transferSingleEvents = await Database.all<any>(`
      SELECT e.event_id, e.transaction_id, e.token_id, e.value, e."contract", operator_a.address AS "operator", from_a.address AS "from", to_a.address AS "to" 
      FROM (
          SELECT *, address_a.address AS "contract"
          FROM erc_1155_transfer_single_events e
          JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
          JOIN addresses address_a ON contract_a.address_id = address_a.address_id
          WHERE address_a.address = "${token.contract}"
          ORDER BY e.event_id ASC
      ) AS e
      JOIN addresses operator_a ON e.from_id = from_a.address_id
      JOIN addresses from_a ON e.from_id = from_a.address_id
      JOIN addresses to_a ON e.to_id = to_a.address_id
      LIMIT 200000
    `);

  const transferBatchEvents = await Database.all<any>(`
    SELECT e.event_id, e."contract", operator_a.address AS "operator", from_a.address AS "from", to_a.address AS "to", e.transaction_id, e.token_ids, e.token_values
    FROM (
        SELECT *, address_a.address AS "contract"
        FROM erc_1155_transfer_batch_events e 
        JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
        JOIN addresses address_a ON contract_a.address_id = address_a.address_id
        WHERE address_a.address = "${token.contract}"
        ORDER BY e.event_id ASC
    ) AS e
    JOIN addresses operator_a ON e.from_id = from_a.address_id
    JOIN addresses from_a ON e.from_id = from_a.address_id
    JOIN addresses to_a ON e.to_id = to_a.address_id
    LIMIT 200000
  `);

  const approvalForAllEvents = await Database.all<any>(`
    SELECT e.event_id, owner_a.address AS "owner", operator_a.address AS "operator",  e.transaction_id, e.approved, e.contract
    FROM (
        SELECT *, address_a.address AS "contract"
        FROM erc_1155_approval_for_all_events e 
        JOIN contracts contract_a ON e.contract_id = contract_a.contract_id
        JOIN addresses address_a ON contract_a.address_id = address_a.address_id
        WHERE address_a.address = "${token.contract}"
        ORDER BY e.event_id ASC
    ) AS e
    JOIN addresses operator_a ON e.operator_id = operator_a.address_id
    JOIN addresses owner_a ON e.owner_id = owner_a.address_id
    LIMIT 200000
  `);

  const normalizeAddress = (addr: string) =>
    addr === 'null' ? ethers.constants.AddressZero : addr;

  return getTxEvents(token, [
    {
      name: 'TransferSingle',
      events: transferSingleEvents,
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
      name: 'TransferBatch',
      events: transferBatchEvents,
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
      name: 'ApprovalForAll',
      events: approvalForAllEvents,
      encode: (e: Erc1155ApprovalForAllEvent) =>
        erc1155Iface.encodeEventLog('ApprovalForAll', [
          normalizeAddress(e.owner),
          normalizeAddress(e.operator),
          e.approved,
        ]),
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

  const blockCount = Math.floor((endTimestamp - startTimestamp) / interval);

  let blockCounter = 0;
  let nextEventIndex = 0;
  let prevBlockNumber = startBlockNumber - 1;
  for (let timestamp = startTimestamp; timestamp <= endTimestamp; timestamp += interval) {
    const block: Block = {
      timestamp,
      number: prevBlockNumber + 1,
      events: [],
    };

    for (let i = nextEventIndex; i < events.length; i++, nextEventIndex++) {
      const event = events[i];

      if (event.block.timestamp >= timestamp + interval) break;

      block.events.push(event);
      block.number = event.blockNumber;
      prevBlockNumber = block.number;
    }

    yield {
      block,
      blockCounter: blockCounter,
      eventCounter: nextEventIndex,
      blockCount: blockCount,
    };

    blockCounter++;
  }
}
