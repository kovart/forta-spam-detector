import {
  Finding,
  getEthersBatchProvider,
  HandleBlock,
  HandleTransaction,
  Initialize,
  TransactionEvent,
} from 'forta-agent';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';

import Logger from './utils/logger';
import { findCreatedContracts, identifyTokenInterface } from './utils/helpers';
import { createSpamNewFinding, createSpamRemoveFinding, createSpamUpdateFinding } from './findings';
import { SpamDetector } from './detector';
import SqlDatabase from './database';
import HoneyPotChecker, { EnsLeaderBoard } from './utils/honeypot';
import TokenAnalyzer from './analyzer/analyzer';
import TokenProvider from './utils/tokens';
import Memoizer from './utils/cache';
import DataStorage from './storage';
import { DataContainer } from './types';
import {
  IS_DEVELOPMENT,
  IS_DEBUG,
  DEBUG_TARGET_TOKEN,
  DATA_PATH,
  DB_FOLDER_PATH,
  DB_FILE_PATH,
} from './contants';
import { JsonStorage, mkdir, rmFile } from './utils/storage';

dayjs.extend(duration);
Logger.level = 'info';

let TICK_INTERVAL = 4 * 60 * 60; // 4h

if (IS_DEBUG) {
  Logger.debug(`Debug mode enabled. Target contract: ${DEBUG_TARGET_TOKEN}`);
  TICK_INTERVAL = 0;
  Logger.level = 'debug';
}

const data = {} as DataContainer;

const provideInitialize = (data: DataContainer, isDevelopment: boolean): Initialize => {
  return async function initialize() {
    const provider = getEthersBatchProvider();

    let storage: DataStorage;
    if (isDevelopment) {
      storage = new DataStorage(new SqlDatabase(':memory:'));
    } else {
      await mkdir(DB_FOLDER_PATH);
      // We delete the database file because skipping some events can lead to state anomalies and hence False Positives
      await rmFile(DB_FILE_PATH);

      storage = new DataStorage(new SqlDatabase(DB_FILE_PATH));
    }

    const memoizer = new Memoizer();
    const leaderStorage = new JsonStorage<any>(DATA_PATH, 'leaders.json');
    const honeypotStorage = new JsonStorage<string[]>(DATA_PATH, 'honeypots.json');
    const tokenStorage = new JsonStorage<any>(DATA_PATH, 'tokens.json');
    const tokenProvider = new TokenProvider(tokenStorage);
    const honeyPotChecker = new HoneyPotChecker(
      new EnsLeaderBoard(leaderStorage),
      new Set(await honeypotStorage.read()),
    );
    const tokenAnalyzer = new TokenAnalyzer(
      provider,
      honeyPotChecker,
      tokenProvider,
      storage,
      memoizer,
    );
    const detector = new SpamDetector(provider, tokenAnalyzer, storage, memoizer, TICK_INTERVAL);

    data.provider = provider;
    data.isDevelopment = isDevelopment;
    data.detector = detector;
    data.analysisByToken = new Map();

    await data.detector.initialize();
  };
};

const provideHandleBlock = (data: DataContainer): HandleBlock => {
  return async function handleBlock(blockEvent) {
    const findings: Finding[] = [];

    const analyses = data.detector.releaseAnalyses();
    for (const { token, result: currentResult } of analyses) {
      const previousResult = data.analysisByToken.get(token);

      const { isSpam, isFinalized } = currentResult.interpret();
      const { isUpdated } = currentResult.compare(previousResult?.analysis);

      const wasSpam = previousResult?.interpret().isSpam || false;

      if (isSpam && !wasSpam) {
        findings.push(createSpamNewFinding(token, currentResult.analysis));
      } else if (isSpam && isUpdated) {
        findings.push(
          createSpamUpdateFinding(token, currentResult.analysis, previousResult!.analysis),
        );
      } else if (!isSpam && wasSpam) {
        findings.push(createSpamRemoveFinding(token, currentResult.analysis));
      }

      if (isFinalized) {
        data.analysisByToken.delete(token);
      } else {
        data.analysisByToken.set(token, currentResult);
      }
    }

    // handleBlock() is executed before handleTransaction()
    if (data.previousBlock) {
      // We pass to the tick information about the block in which there were previous transactions collected in the storage
      data.detector.tick(data.previousBlock.timestamp, data.previousBlock.number);

      if (IS_DEBUG && blockEvent.blockNumber % 10 === 0) {
        await data.detector.wait();
      }

      if (blockEvent.blockNumber % 10 == 0) data.detector.logStats();
    }

    data.previousBlock = blockEvent.block;

    return findings;
  };
};

const provideHandleTransaction = (data: DataContainer): HandleTransaction => {
  return async function handleTransaction(txEvent: TransactionEvent) {
    const createdContracts = findCreatedContracts(txEvent);

    if (createdContracts.length > 0) {
      Logger.debug(`Found ${createdContracts.length} created contracts in tx: ${txEvent.hash}`);
    }

    for (const contract of createdContracts) {
      const type = await identifyTokenInterface(contract.address, data.provider);

      if (type) {
        if (IS_DEBUG && DEBUG_TARGET_TOKEN !== contract.address) continue;

        Logger.debug(`Found token contract (ERC${type}): ${contract.address}`);
        data.detector.addTokenToWatchList(type, contract);
      }
    }

    await data.detector.handleTxEvent(txEvent);

    return [];
  };
};

export default {
  initialize: provideInitialize(data, IS_DEVELOPMENT),
  handleTransaction: provideHandleTransaction(data),
  handleBlock: provideHandleBlock(data),
};
