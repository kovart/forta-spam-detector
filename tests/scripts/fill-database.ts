import { ethers } from 'ethers';
import { filterGoodProviders, getPreloadStorage, Logger } from '../utils';
import { DATA_PATH, TEST_ETHEREUM_PRC_URLS, TEST_DB_PATH, TOKEN_ADDRESSES } from '../constants';
import { TokenContract, TokenStandard } from '../../src/types';
import SqlDatabase from '../../src/database/database';
import { TOKEN_OBSERVATION_TIME } from '../../src/analyzer/modules/observation-time';
import { PreloadedIndexer } from '../indexer/preloaded-indexer';

let isTransactionNotFinished = false;
let database: SqlDatabase;
let indexer: PreloadedIndexer;
let LIMIT = 999_999;

async function collect(token: TokenContract) {
  const handlers = {
    [TokenStandard.Erc20]: [
      {
        label: 'Transfer',
        getEvents: indexer.getErc20TransferEvents.bind(indexer),
        addEvent: database.addErc20TransferEvent.bind(database),
      },
      {
        label: 'Approval',
        getEvents: indexer.getErc20ApprovalEvents.bind(indexer),
        addEvent: database.addErc20ApprovalEvent.bind(database),
      },
    ],
    [TokenStandard.Erc721]: [
      {
        label: 'Transfer',
        getEvents: indexer.getErc721TransferEvents.bind(indexer),
        addEvent: database.addErc721TransferEvent.bind(database),
      },
      {
        label: 'Approval',
        getEvents: indexer.getErc721ApprovalEvents.bind(indexer),
        addEvent: database.addErc721ApprovalEvent.bind(database),
      },
      {
        label: 'ApprovalForAll',
        getEvents: indexer.getErc721ApprovalForAllEvents.bind(indexer),
        addEvent: database.addErc721ApprovalForAllEvent.bind(database),
      },
    ],
    [TokenStandard.Erc1155]: [
      {
        label: 'TransferSingle',
        getEvents: indexer.getErc1155TransferSingleEvents.bind(indexer),
        addEvent: database.addErc1155TransferSingleEvent.bind(database),
      },
      {
        label: 'TransferBatch',
        getEvents: indexer.getErc1155TransferBatchEvents.bind(indexer),
        addEvent: database.addErc1155TransferBatchEvent.bind(database),
      },
      {
        label: 'ApprovalForAll',
        getEvents: indexer.getErc1155ApprovalForAllEvents.bind(indexer),
        addEvent: database.addErc1155ApprovalForAllEvent.bind(database),
      },
    ],
  };

  const eventHandlers = handlers[token.type];
  const eventMap: { [key: string]: any[] } = {};

  for (const eventHandler of eventHandlers) {
    Logger.info(`Getting ${token.type}-${eventHandler.label} events...`);

    eventMap[eventHandler.label] = await eventHandler.getEvents(
      {
        contract: token.address,
        endDate: token.timestamp + TOKEN_OBSERVATION_TIME,
      },
      { limit: LIMIT },
    );
  }

  const transactions = await indexer.getTransactionsByContract(
    { contract: token.address, endDate: token.timestamp + TOKEN_OBSERVATION_TIME },
    { limit: LIMIT },
  );

  const transactionHashSet = new Set(transactions.map((t) => t.hash));

  const missingTxHashes = [
    ...new Set(
      Object.values(eventMap)
        .flat()
        .map((e) => e.transactionHash),
    ),
  ].filter((hash) => !transactionHashSet.has(hash));

  Logger.info(`Missing tx hashes from events: ${missingTxHashes.length}`);

  if (missingTxHashes.length > 0) {
    Logger.info(`Getting missing transactions...`);
    const restTransactions = await indexer.getTransactionsByHashes(
      { hashes: missingTxHashes },
      { limit: LIMIT },
    );

    for (const tx of restTransactions) {
      transactions.push(tx);
    }
  }

  Logger.info(`Adding to the database...`);

  isTransactionNotFinished = true;
  await database.exec(`BEGIN TRANSACTION`);

  database.addToken({
    address: token.address,
    deployer: token.deployer,
    timestamp: token.timestamp,
    type: token.type,
    blockNumber: token.blockNumber,
  });

  for (const tx of transactions) {
    database.addTransaction(tx);
  }

  for (const eventHandler of eventHandlers) {
    const events = eventMap[eventHandler.label];
    for (const event of events) {
      eventHandler.addEvent({
        ...event,
        contract: token.address,
      });
    }
  }

  await database.exec(`COMMIT TRANSACTION`);

  Logger.debug('Waiting for database to save the data');

  await database.wait();

  isTransactionNotFinished = false;
}

async function main() {
  const preloadStorage = getPreloadStorage(DATA_PATH, 'preload.csv');
  const preloadedRows = (await preloadStorage.read()) || [];

  if (!preloadedRows || preloadedRows.length === 0)
    throw new Error('No preloaded data. Please read the README.md');

  const providers = await filterGoodProviders(
    TEST_ETHEREUM_PRC_URLS.map((url) => new ethers.providers.JsonRpcBatchProvider(url)),
  );

  database = new SqlDatabase(TEST_DB_PATH);
  indexer = new PreloadedIndexer(preloadedRows, providers, [], {
    concurrency: 4,
    logsConcurrency: 4,
  });

  await database.initialize();
  const collectedTokens = await database.getTokens();
  const collectedAddressSet = new Set(collectedTokens.map((t) => t.address));

  const tokenAddresses: string[] = [];
  for (const address of TOKEN_ADDRESSES) {
    if (collectedAddressSet.has(address)) continue;
    tokenAddresses.push(address.toLowerCase());
  }

  for (const tokenAddress of tokenAddresses) {
    const info = preloadedRows.find((r) => r.contract === tokenAddress);

    if (!info) {
      throw new Error(`Preloaded data doesn't contain token: ${tokenAddress}`);
    }

    Logger.info(`Collecting data for ${tokenAddress}...`);

    await collect({
      address: info.contract,
      blockNumber: info.blockNumber,
      timestamp: info.timestamp,
      type: info.type,
      deployer: info.deployer,
    });

    indexer.clearCache();
  }

  if (tokenAddresses.length > 0) {
    Logger.info('All data has been successfully collected');
  }
}

function exitHandler(error?: any) {
  if (error) Logger.error(error);

  if (isTransactionNotFinished) {
    database.db.exec(`ROLLBACK`, (err) => {
      if (err) Logger.error(err);
    });

    Logger.warn('Exiting...');
    database
      .close()
      .then(() => Logger.warn('Database has been closed'))
      .catch((err) => {
        Logger.error(err);
      })
      .finally(() => process.exit());
  } else {
    process.exit();
  }
}

//do something when app is closing
process.on('exit', () => exitHandler());

//catches ctrl+c event
process.on('SIGINT', () => exitHandler());
process.on('SIGTERM', () => exitHandler());

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', () => exitHandler());
process.on('SIGUSR2', () => exitHandler());

//catches uncaught exceptions
process.on('uncaughtException', (err) => exitHandler(err));

main().catch((e) => {
  Logger.error(e);
  return 1;
});
