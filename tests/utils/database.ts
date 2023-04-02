import path from 'path';
import sqlite3 from 'sqlite3';
import { chunk, uniqBy } from 'lodash';

import { PATH_CONFIGS } from '../scripts/contants';
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
} from '../scripts/types';
import { TokenStandard } from '../../src/types';

const MAX_COMPOUND_SELECT = 500;

const db = new (sqlite3.verbose().Database)(
  path.resolve(PATH_CONFIGS.DATA_DIRECTORY, './events.db'),
  (err) => {
    if (err) return console.error(err.message);
    console.log('Connected to the SQlite database.');
  },
);

const run = (sql: string) => {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) return reject(err);
      else resolve(null);
    });
  });
};

const all = <T>(sql: string): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    db.all<T>(sql, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows);
    });
  });
};

function init() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS addresses (
      address_id INTEGER PRIMARY KEY AUTOINCREMENT,
      address VARCHAR(42) NOT NULL UNIQUE
    )`);

    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_address ON addresses (address)`);

    db.run(`CREATE TABLE IF NOT EXISTS contracts (
      contract_id INTEGER PRIMARY KEY AUTOINCREMENT,
      address_id INTEGER NOT NULL UNIQUE,
      type SMALLINT NOT NULL,
      FOREIGN KEY (address_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
      transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      transaction_hash VARCHAR(6) NOT NULL,
      FOREIGN KEY (from_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (to_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
    )`);

    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_hash ON transactions (transaction_hash, block_number, timestamp)`,
    );

    db.run(`CREATE TABLE IF NOT EXISTS erc_20_transfer_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      value TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (contract_id) REFERENCES contracts (contract_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (from_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (to_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS erc_20_approval_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      spender_id INTEGER NOT NULL,
      value TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (contract_id) REFERENCES contracts (contract_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (spender_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS erc_721_transfer_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      token_id TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (contract_id) REFERENCES contracts (contract_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (from_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (to_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS erc_721_approval_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      approved_id INTEGER NOT NULL,
      token_id TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (contract_id) REFERENCES contracts (contract_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (approved_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS erc_721_approval_for_all_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      owner_id INTEGER NOT NULL,
      operator_id INTEGER NOT NULL,
      approved BOOLEAN NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (contract_id) REFERENCES contracts (contract_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (operator_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS erc_1155_transfer_single_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id INTEGER NOT NULL,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      token_id TEXT NOT NULL,
      value TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (contract_id) REFERENCES contracts (contract_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (operator_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (from_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (to_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS erc_1155_transfer_batch_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id INTEGER NOT NULL,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      token_ids TEXT NOT NULL,
      token_values TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (contract_id) REFERENCES contracts (contract_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (operator_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
      FOREIGN KEY (from_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (to_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS erc_1155_approval_for_all_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      operator_id INTEGER NOT NULL,
      approved BOOLEAN NOT NULL,
      transaction_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (contract_id) REFERENCES contracts (contract_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (operator_id) REFERENCES addresses (address_id) ON UPDATE CASCADE ON DELETE CASCADE
    )`);
  });
}

function close(cb?: () => unknown) {
  db.close((err) => {
    if (err) return console.error(err.message);
    console.log('Close the database connection.');
    if (cb) cb();
  });
}

const getTransactionHash = (hash: string) => `${hash.slice(2, 8)}`;

function insertAddresses(addresses: string[]) {
  addresses = [...new Set(addresses)];

  for (const batch of chunk(addresses, MAX_COMPOUND_SELECT)) {
    db.run(`
      INSERT INTO addresses(address)
      ${batch
        .map((a) => {
          return `SELECT '${a}' WHERE NOT EXISTS (SELECT 1 FROM addresses WHERE address = '${a}')`;
        })
        .join(' UNION ALL ')}
  `);
  }
}

function insertTransactions(rows: DuneEvent[]) {
  rows = uniqBy(rows, (e) => getTransactionHash(e.tx_hash) + e.block_number + e.timestamp);

  for (const batch of chunk(rows, MAX_COMPOUND_SELECT)) {
    db.run(`
      INSERT INTO transactions(transaction_hash, from_id, to_id, block_number, timestamp)
      SELECT transaction_hash, from_id, to_id, block_number, timestamp
      FROM (
        ${batch
          .map(
            (e) =>
              `SELECT ` +
              `'${getTransactionHash(e.tx_hash)}' AS transaction_hash,` +
              `(SELECT address_id FROM addresses WHERE address = '${e.tx_from}') AS from_id,` +
              `(SELECT address_id FROM addresses WHERE address = '${e.tx_to}') AS to_id,` +
              `${e.block_number} AS block_number,` +
              `${e.timestamp} AS "timestamp"`,
          )
          .join(' UNION ALL ')}
      ) AS new_transactions
      WHERE NOT EXISTS (
        SELECT 1
        FROM transactions
        WHERE
          "transaction_hash" = new_transactions."transaction_hash"
          AND "block_number" = new_transactions."block_number"
          AND "timestamp" = new_transactions."timestamp"
      )
  `);
  }
}

function insertContracts(type: TokenStandard, rows: DuneEvent[]) {
  const contracts = [...new Set(rows.map((r) => r.contract))];

  for (const batch of chunk(contracts, MAX_COMPOUND_SELECT)) {
    db.run(`
      INSERT INTO contracts(type, address_id)
      SELECT type, address_id
      FROM (
          ${batch
            .map((a) => {
              return `SELECT ${type} AS type, (SELECT address_id FROM addresses WHERE address = '${a}') AS address_id`;
            })
            .join(' UNION ALL ')}
      ) AS new_contracts
      WHERE NOT EXISTS (
        SELECT 1
        FROM contracts
        WHERE contracts.address_id = new_contracts.address_id
      )`);
  }
}

function insertErc20TransferEvents(rows: Erc20TransferEvent[]) {
  db.serialize(() => {
    insertAddresses(rows.map((r) => [r.from, r.to, r.tx_from, r.tx_to, r.contract]).flat());
    insertTransactions(rows);
    insertContracts(TokenStandard.Erc20, rows);

    for (const batch of chunk(rows, MAX_COMPOUND_SELECT)) {
      db.run(`
        INSERT INTO erc_20_transfer_events(transaction_id, contract_id, from_id, to_id, value)
        ${batch
          .map((e) => {
            const hash = getTransactionHash(e.tx_hash);
            return (
              `SELECT ` +
              `(SELECT transaction_id FROM transactions WHERE "transaction_hash" = '${hash}' AND "block_number" = ${e.block_number} AND "timestamp" = ${e.timestamp}),` +
              `(SELECT contract_id FROM contracts LEFT JOIN addresses ON contracts.address_id = addresses.address_id WHERE address = '${e.contract}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.from}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.to}'),` +
              `'${e.value}'`
            );
          })
          .join(' UNION ALL ')}
      `);
    }
  });
}

function insertErc20ApprovalEvents(rows: Erc20ApprovalEvent[]) {
  db.serialize(() => {
    insertAddresses(rows.map((r) => [r.owner, r.spender, r.tx_from, r.tx_to, r.contract]).flat());
    insertTransactions(rows);
    insertContracts(TokenStandard.Erc20, rows);

    for (const batch of chunk(rows, MAX_COMPOUND_SELECT)) {
      db.run(`
        INSERT INTO erc_20_approval_events(transaction_id, contract_id, owner_id, spender_id, value)
        ${batch
          .map((e) => {
            const hash = getTransactionHash(e.tx_hash);
            return (
              `SELECT ` +
              `(SELECT transaction_id FROM transactions WHERE "transaction_hash" = '${hash}' AND "block_number" = ${e.block_number} AND "timestamp" = ${e.timestamp}),` +
              `(SELECT contract_id FROM contracts LEFT JOIN addresses ON contracts.address_id = addresses.address_id WHERE address = '${e.contract}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.owner}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.spender}'),` +
              `'${e.value}'`
            );
          })
          .join(' UNION ALL ')}
      `);
    }
  });
}

function insertErc721TransferEvents(rows: Erc721TransferEvent[]) {
  db.serialize(() => {
    insertAddresses(rows.map((r) => [r.from, r.to, r.tx_from, r.tx_to, r.contract]).flat());
    insertTransactions(rows);
    insertContracts(TokenStandard.Erc721, rows);

    for (const batch of chunk(rows, MAX_COMPOUND_SELECT)) {
      db.run(`
        INSERT INTO erc_721_transfer_events(transaction_id, contract_id, from_id, to_id, token_id)
        ${batch
          .map((e) => {
            const hash = getTransactionHash(e.tx_hash);
            return (
              `SELECT ` +
              `(SELECT transaction_id FROM transactions WHERE "transaction_hash" = '${hash}' AND "block_number" = ${e.block_number} AND "timestamp" = ${e.timestamp}),` +
              `(SELECT contract_id FROM contracts LEFT JOIN addresses ON contracts.address_id = addresses.address_id WHERE address = '${e.contract}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.from}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.to}'),` +
              `'${e.token_id}'`
            );
          })
          .join(' UNION ALL ')}
      `);
    }
  });
}

function insertErc721ApprovalEvents(rows: Erc721ApprovalEvent[]) {
  db.serialize(() => {
    insertAddresses(rows.map((r) => [r.owner, r.approved, r.tx_from, r.tx_to, r.contract]).flat());
    insertTransactions(rows);
    insertContracts(TokenStandard.Erc721, rows);

    for (const batch of chunk(rows, MAX_COMPOUND_SELECT)) {
      db.run(`
        INSERT INTO erc_721_approval_events(transaction_id, contract_id, owner_id, approved_id, token_id)
        ${batch
          .map((e) => {
            const hash = getTransactionHash(e.tx_hash);
            return (
              `SELECT ` +
              `(SELECT transaction_id FROM transactions WHERE "transaction_hash" = '${hash}' AND "block_number" = ${e.block_number} AND "timestamp" = ${e.timestamp}),` +
              `(SELECT contract_id FROM contracts LEFT JOIN addresses ON contracts.address_id = addresses.address_id WHERE address = '${e.contract}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.owner}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.approved}'),` +
              `'${e.token_id}'`
            );
          })
          .join(' UNION ALL ')}
      `);
    }
  });
}

function insertErc721ApprovalForAllEvents(rows: Erc721ApprovalForAllEvent[]) {
  db.serialize(() => {
    insertAddresses(rows.map((r) => [r.owner, r.operator, r.tx_from, r.tx_to, r.contract]).flat());
    insertTransactions(rows);
    insertContracts(TokenStandard.Erc721, rows);

    for (const batch of chunk(rows, MAX_COMPOUND_SELECT)) {
      db.run(`
        INSERT INTO erc_721_approval_for_all_events(transaction_id, contract_id, owner_id, operator_id, approved)
        ${batch
          .map((e) => {
            const hash = getTransactionHash(e.tx_hash);
            return (
              `SELECT ` +
              `(SELECT transaction_id FROM transactions WHERE "transaction_hash" = '${hash}' AND "block_number" = ${e.block_number} AND "timestamp" = ${e.timestamp}),` +
              `(SELECT contract_id FROM contracts LEFT JOIN addresses ON contracts.address_id = addresses.address_id WHERE address = '${e.contract}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.owner}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.operator}'),` +
              `${String(e.approved).toUpperCase()}`
            );
          })
          .join(' UNION ALL ')}
      `);
    }
  });
}

function insertErc1155TransferSingleEvents(rows: Erc1155TransferSingleEvent[]) {
  db.serialize(() => {
    insertAddresses(
      rows.map((r) => [r.operator, r.from, r.to, r.tx_from, r.tx_to, r.contract]).flat(),
    );
    insertTransactions(rows);
    insertContracts(TokenStandard.Erc1155, rows);

    for (const batch of chunk(rows, MAX_COMPOUND_SELECT)) {
      db.run(`
        INSERT INTO erc_1155_transfer_single_events(transaction_id, contract_id, operator_id, from_id, to_id, token_id, value)
        ${batch
          .map((e) => {
            const hash = getTransactionHash(e.tx_hash);
            return (
              `SELECT ` +
              `(SELECT transaction_id FROM transactions WHERE "transaction_hash" = '${hash}' AND "block_number" = ${e.block_number} AND "timestamp" = ${e.timestamp}),` +
              `(SELECT contract_id FROM contracts LEFT JOIN addresses ON contracts.address_id = addresses.address_id WHERE address = '${e.contract}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.operator}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.from}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.to}'),` +
              `'${e.token_id}',` +
              `'${e.value}'`
            );
          })
          .join(' UNION ALL ')}
      `);
    }
  });
}

function insertErc1155TransferBatchEvents(rows: Erc1155TransferBatchEvent[]) {
  db.serialize(() => {
    insertAddresses(
      rows.map((r) => [r.operator, r.from, r.to, r.tx_from, r.tx_to, r.contract]).flat(),
    );
    insertTransactions(rows);
    insertContracts(TokenStandard.Erc1155, rows);

    for (const batch of chunk(rows, MAX_COMPOUND_SELECT)) {
      db.run(`
        INSERT INTO erc_1155_transfer_batch_events(transaction_id, contract_id, operator_id, from_id, to_id, token_ids, token_values)
        ${batch
          .map((e) => {
            const hash = getTransactionHash(e.tx_hash);
            return (
              `SELECT ` +
              `(SELECT transaction_id FROM transactions WHERE "transaction_hash" = '${hash}' AND "block_number" = ${e.block_number} AND "timestamp" = ${e.timestamp}),` +
              `(SELECT contract_id FROM contracts LEFT JOIN addresses ON contracts.address_id = addresses.address_id WHERE address = '${e.contract}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.operator}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.from}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.to}'),` +
              `'${e.token_ids}',` +
              `'${e.token_values}'`
            );
          })
          .join(' UNION ALL ')}
      `);
    }
  });
}

function insertErc1155ApprovalForAllEvents(rows: Erc1155ApprovalForAllEvent[]) {
  db.serialize(() => {
    insertAddresses(rows.map((r) => [r.owner, r.operator, r.tx_from, r.tx_to, r.contract]).flat());
    insertTransactions(rows);
    insertContracts(TokenStandard.Erc1155, rows);

    for (const batch of chunk(rows, MAX_COMPOUND_SELECT)) {
      db.run(`
        INSERT INTO erc_1155_approval_for_all_events(transaction_id, contract_id, owner_id, operator_id, approved)
        ${batch
          .map((e) => {
            const hash = getTransactionHash(e.tx_hash);
            return (
              `SELECT ` +
              `(SELECT transaction_id FROM transactions WHERE "transaction_hash" = '${hash}' AND "block_number" = ${e.block_number} AND "timestamp" = ${e.timestamp}),` +
              `(SELECT contract_id FROM contracts LEFT JOIN addresses ON contracts.address_id = addresses.address_id WHERE address = '${e.contract}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.owner}'),` +
              `(SELECT address_id FROM addresses WHERE address = '${e.operator}'),` +
              `${String(e.approved).toUpperCase()}`
            );
          })
          .join(' UNION ALL ')}
      `);
    }
  });
}

const Database = {
  db,
  init,
  close,
  run,
  all,

  insertErc20TransferEvents,
  insertErc20ApprovalEvents,
  insertErc721TransferEvents,
  insertErc721ApprovalEvents,
  insertErc721ApprovalForAllEvents,
  insertErc1155TransferSingleEvents,
  insertErc1155TransferBatchEvents,
  insertErc1155ApprovalForAllEvents,
};

export default Database;
