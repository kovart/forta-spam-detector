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
import { DataContainer } from './types';
import { IS_DEVELOPMENT, IS_DEBUG, DEBUG_TARGET_TOKEN } from './contants';

dayjs.extend(duration);
Logger.level = 'info';

let TICK_INTERVAL = 4 * 60 * 60; // 4h

if (IS_DEBUG) {
  Logger.debug(`Debug mode enabled. Target contract: ${DEBUG_TARGET_TOKEN}`);
  TICK_INTERVAL = 0;
}

const data = {} as DataContainer;

const provideInitialize = (data: DataContainer, isDevelopment: boolean): Initialize => {
  return async function initialize() {
    const provider = getEthersBatchProvider();

    data.provider = provider;
    data.isDevelopment = isDevelopment;
    data.detector = new SpamDetector(provider, TICK_INTERVAL);
    data.analysisByToken = new Map();
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

    data.detector.tick(blockEvent.block.timestamp, blockEvent.blockNumber);

    if (IS_DEBUG && blockEvent.blockNumber % 10 === 0) {
      await data.detector.wait();
    }

    if (blockEvent.blockNumber % 10 == 0) data.detector.logStats();

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

    data.detector.handleTxEvent(txEvent);

    return [];
  };
};

export default {
  initialize: provideInitialize(data, IS_DEVELOPMENT),
  handleTransaction: provideHandleTransaction(data),
  handleBlock: provideHandleBlock(data),
};
