import {
  BlockEvent,
  Finding,
  getEthersBatchProvider,
  HandleBlock,
  HandleTransaction,
  Initialize,
  TransactionEvent,
} from 'forta-agent';
import axios from 'axios';
import dayjs from 'dayjs';
import { BotSharding } from 'forta-sharding';
import { createTicker } from 'forta-helpers';
import { FortaBotStorage, InMemoryBotStorage } from 'forta-bot-analytics';
import duration from 'dayjs/plugin/duration';

import Logger from './utils/logger';
import { combine, findCreatedContracts, identifyTokenInterface } from './utils/helpers';
import {
  createPhishingNewFinding,
  createPhishingRemoveFinding,
  createPhishingUpdateFinding,
  createSpamNewFinding,
  createSpamRemoveFinding,
  createSpamUpdateFinding,
} from './findings';
import { SpamDetector } from './detector';
import SqlDatabase from './database/database';
import HoneyPotChecker, { EnsLeaderBoard } from './utils/honeypot';
import TokenAnalyzer from './analyzer/analyzer';
import TokenProvider from './utils/tokens';
import Memoizer from './utils/cache';
import PhishingMetadataModule from './analyzer/modules/phishing-metadata';
import DataStorage from './storage';
import { AlertRemoveItem, DataContainer } from './types';
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
import { random } from 'lodash';

dayjs.extend(duration);
Logger.level = 'info';

let TICK_INTERVAL = 4 * 60 * 60; // 4h

if (IS_DEBUG) {
  Logger.level = 'trace';
  Logger.debug(`Debug mode enabled. Target contract: ${DEBUG_TARGET_TOKEN}`);
  TICK_INTERVAL = 0;
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

    const alertManager = new AlertMitigation<AlertRemoveItem>({
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
    await data.sharding.sync(network.chainId);

    Logger.warn(`Bot has been successfully initialized.`);

    data.isInitialized = true;
  };
};

const provideHandleBlock = (data: DataContainer): HandleBlock => {
  const isTimeToLog = createTicker(12 * 60 * 60 * 1000); // 12h

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

      if (isTimeToLog(blockEvent.block.timestamp)) data.detector.logStats();
    }

    const analyses = data.detector.releaseAnalyses();
    for (const { token, result: currentResult } of analyses) {
      const previousResult = data.analysisByToken.get(token);

      const { isSpam, isPhishing, isFinalized, confidence } = currentResult.interpret();
      const { isUpdated } = currentResult.compare(previousResult?.analysis);

      const previousInterpretation = previousResult?.interpret();
      const previousConfidence = previousInterpretation?.confidence || confidence;
      const wasSpam = previousInterpretation?.isSpam || false;
      const wasPhishing = previousInterpretation?.isPhishing || false;

      if (isSpam && !wasSpam) {
        findings.push(createSpamNewFinding(token, currentResult.analysis, confidence));

        if (isPhishing) {
          findings.push(createPhishingNewFinding(token, currentResult.analysis, confidence));
        }
      } else if (isSpam && isUpdated) {
        findings.push(
          createSpamUpdateFinding(
            token,
            currentResult.analysis,
            previousResult!.analysis,
            confidence,
            previousConfidence,
          ),
        );

        if (isPhishing) {
          findings.push(
            createPhishingUpdateFinding(
              token,
              currentResult.analysis,
              confidence,
              previousConfidence,
            ),
          );
        }
      } else if (!isSpam && wasSpam) {
        findings.push(createSpamRemoveFinding(token, currentResult.analysis));

        if (wasPhishing) {
          findings.push(createPhishingRemoveFinding(token, currentResult.analysis));
        }
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
  const isTimeToLogSharding = createTicker(2 * 60 * 60 * 1000); // 2h

  return async function handleTransaction(txEvent: TransactionEvent) {
    // TODO filter db by current block number
    // TODO add indicator for a well-known token from a centralized db
    // TODO monitor "removed liquidity with no further activity"
    // TODO check for a partial match in the name then checking the metadata with the images

    if (isTimeToSync(txEvent.timestamp)) {
      await data.sharding.sync(txEvent.network);
    }

    if (isTimeToLogSharding(txEvent.timestamp)) {
      Logger.info(
        `Shards: ${data.sharding.getShardCount()}. Shard index: ${data.sharding.getShardIndex()}`,
      );
    }

    // Sharded logic
    if (txEvent.blockNumber % data.sharding.getShardCount() === data.sharding.getShardIndex()) {
      const createdContracts = findCreatedContracts(txEvent);

      if (createdContracts.length > 0) {
        Logger.debug(`Found ${createdContracts.length} created contracts in tx: ${txEvent.hash}`);
        Logger.trace(createdContracts);
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
  const isTimeToOptimizeStorage = createTicker(24 * 60 * 60 * 1000 * random(1, 1.2));
  const isTimeToFetchFalseFindings = createTicker(2 * 60 * 60 * 1000 * random(1, 1.2));

  return async (blockEvent: BlockEvent) => {
    if (IS_DEVELOPMENT) return [];

    try {
      if (isTimeToOptimizeStorage(blockEvent.block.timestamp)) {
        await data.alertMitigation.optimizeStorage();
      }

      if (isTimeToFetchFalseFindings(blockEvent.block.timestamp)) {
        const tokens = await data.alertMitigation.getFalseFindings();

        if (tokens.length > 0) {
          Logger.info(`New false positive findings: ${tokens.length}`);
        }

        await data.alertMitigation.markFindingsAsRemoved(tokens);

        return tokens
          .map((item) => {
            const findings: Finding[] = [createSpamRemoveFinding(item, {})];

            if (item.isPhishing) {
              findings.push(
                createPhishingRemoveFinding(item, {
                  [PhishingMetadataModule.Key]: {
                    detected: true,
                    metadata: { urls: item.phishingUrls || [] },
                  },
                }),
              );
            }

            return findings;
          })
          .flat();
      }
    } catch (e) {
      Logger.error('Alert mitigation error');
      if (axios.isAxiosError(e)) {
        Logger.error(`${e.code}: ${e.message}`);
      } else {
        Logger.error(e);
      }
    }

    return [];
  };
};

process.on('uncaughtException', (e) => {
  console.error(e);
});

process.on('unhandledRejection', (e) => {
  console.error(e);
});

export default {
  initialize: provideInitialize(data, IS_DEVELOPMENT),
  handleTransaction: provideHandleTransaction(data),
  handleBlock: combine(provideHandleBlock(data), provideAlertMitigation(data)),
};
