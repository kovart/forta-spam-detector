import {
  BlockEvent,
  Finding,
  getEthersBatchProvider,
  HandleBlock,
  HandleTransaction,
  Initialize,
  TransactionEvent,
} from 'forta-agent';
import dayjs from 'dayjs';
import { BotSharding } from 'forta-sharding';
import { createTicker } from 'forta-helpers';
import { FortaBotStorage, InMemoryBotStorage } from 'forta-bot-analytics';
import duration from 'dayjs/plugin/duration';

import Logger from './utils/logger';
import { combine, findCreatedContracts, identifyTokenInterface } from './utils/helpers';
import { createSpamNewFinding, createSpamRemoveFinding, createSpamUpdateFinding } from './findings';
import { SpamDetector } from './detector';
import SqlDatabase from './database';
import HoneyPotChecker, { EnsLeaderBoard } from './utils/honeypot';
import TokenAnalyzer from './analyzer/analyzer';
import TokenProvider from './utils/tokens';
import Memoizer from './utils/cache';
import DataStorage from './storage';
import { DataContainer, Token } from './types';
import {
  IS_DEVELOPMENT,
  IS_DEBUG,
  DEBUG_TARGET_TOKEN,
  DATA_PATH,
  DB_FOLDER_PATH,
  DB_FILE_PATH,
  FALSE_FINDINGS_URL,
} from './contants';
import { JsonStorage, mkdir, rmFile } from './utils/storage';
import { AlertMitigation } from './utils/mitigation';

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
    const network = await provider.getNetwork();

    let storage: DataStorage;
    if (isDevelopment) {
      await mkdir(DB_FOLDER_PATH);
      await rmFile(DB_FILE_PATH);
      storage = new DataStorage(new SqlDatabase(DB_FILE_PATH));
    } else {
      await mkdir(DB_FOLDER_PATH);
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
    const sharding = new BotSharding({
      redundancy: 3,
      isDevelopment: IS_DEVELOPMENT,
    });
    const alertManager = new AlertMitigation<Token>({
      chainId: network.chainId,
      falseFindingsUrl: data.isDevelopment ? undefined : FALSE_FINDINGS_URL,
      storage: data.isDevelopment ? new InMemoryBotStorage() : new FortaBotStorage(),
      getHash: (t) => t.address,
    });

    data.alertMitigation = alertManager;
    data.sharding = sharding;
    data.provider = provider;
    data.isDevelopment = isDevelopment;
    data.detector = detector;
    data.analysisByToken = new Map();

    await data.detector.initialize();

    Logger.warn(`Bot has been successfully initialized.`);
    data.detector.logStats();

    data.isInitialized = true;
  };
};

const provideHandleBlock = (data: DataContainer): HandleBlock => {
  return async function handleBlock(blockEvent) {
    const findings: Finding[] = [];

    // handleBlock() is executed before handleTransaction()
    if (data.previousBlock) {
      // We pass to the tick information about the block in which there were previous transactions collected in the storage
      if (!IS_DEBUG) {
        data.detector.tick(data.previousBlock.timestamp, data.previousBlock.number);
      }

      if (IS_DEBUG && blockEvent.blockNumber % 10 === 0) {
        data.detector.tick(data.previousBlock.timestamp, data.previousBlock.number);
        await data.detector.wait();
      }

      if (blockEvent.blockNumber % 500 == 0) data.detector.logStats();
    }

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

    data.previousBlock = blockEvent.block;

    return findings;
  };
};

const provideHandleTransaction = (data: DataContainer): HandleTransaction => {
  const isTimeToSync = createTicker(5 * 60 * 1000); // 5m

  return async function handleTransaction(txEvent: TransactionEvent) {
    // TODO filter db by current block number
    // TODO add indicator for a well-known token from a centralized db
    // TODO monitor "removed liquidity with no further activity"

    if (isTimeToSync(txEvent.timestamp)) {
      await data.sharding.sync(txEvent.network);
    }

    // Sharded logic
    if (txEvent.blockNumber % data.sharding.getShardCount() === data.sharding.getShardIndex()) {
      const createdContracts = findCreatedContracts(txEvent);

      if (!IS_DEBUG && createdContracts.length > 0) {
        Logger.debug(`Found ${createdContracts.length} created contracts in tx: ${txEvent.hash}`);
      }

      for (const contract of createdContracts) {
        const type = await identifyTokenInterface(contract.address, data.provider);

        if (type) {
          if (IS_DEBUG) {
            if (DEBUG_TARGET_TOKEN !== contract.address) continue;

            Logger.info(`Found target token: ${contract.address}`);
          }

          Logger.debug(`Found token contract (ERC${type}): ${contract.address}`);
          data.detector.addTokenToWatchList(type, contract);
        }
      }
    }

    // Non-sharded logic
    await data.detector.handleTxEvent(txEvent);

    return [];
  };
};

const provideAlertMitigation = (data: DataContainer): HandleBlock => {
  return async (blockEvent: BlockEvent) => {
    try {
      // We use such a block number so that it can be executed at different times with fetching false findings
      if (blockEvent.blockNumber % 5_010 === 0) {
        await data.alertMitigation.optimizeStorage();
        Logger.info(`Alerts mitigation module has been successfully optimized`);
      }

      if (blockEvent.blockNumber % 250 === 0) {
        const tokens = await data.alertMitigation.getFalseFindings();

        if (tokens.length > 0) {
          Logger.info(`New false positive findings: ${tokens.length}`);
        }

        await data.alertMitigation.markFindingsAsRemoved(tokens);
        return tokens.map((t) => createSpamRemoveFinding(t, {}));
      }
    } catch (e) {
      Logger.error('Alert mitigation error');
      Logger.error(e);
    }

    return [];
  };
};

export default {
  initialize: provideInitialize(data, IS_DEVELOPMENT),
  handleTransaction: provideHandleTransaction(data),
  handleBlock: combine(provideHandleBlock(data), provideAlertMitigation(data)),
};
