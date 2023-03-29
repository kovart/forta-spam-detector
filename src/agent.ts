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
import duration from 'dayjs/plugin/duration';

dayjs.extend(duration);

import { findCreatedContracts, identifyTokenInterface } from './utils/helpers';
import { SpamDetector } from './detector';
import { DataContainer } from './types';
import { createSpamNewFinding, createSpamRemoveFinding, createSpamUpdateFinding } from './findings';

const IS_DEBUG = process.env.debug === '1';
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
const TICK_INTERVAL = 15 * 60 * 1000;

const data = {} as DataContainer;
const provideInitialize = (
  data: DataContainer,
  isDevelopment: boolean,
  isDebug: boolean,
): Initialize => {
  return async function initialize() {
    const provider = getEthersBatchProvider();

    data.provider = provider;
    data.isDebug = isDebug;
    data.isDevelopment = isDevelopment;
    data.detector = new SpamDetector(provider, TICK_INTERVAL);
    data.analysisByToken = new Map();
  };
};
const provideHandleTransaction = (data: DataContainer): HandleTransaction => {
  return async function handleTransaction(txEvent: TransactionEvent) {
    const createdContracts = findCreatedContracts(txEvent);

    for (const contract of createdContracts) {
      const type = await identifyTokenInterface(contract.address, data.provider);
      if (type) {
        data.detector.addTokenToWatchList(type, contract);
      }
    }

    data.detector.handleTxEvent(txEvent);

    data.detector.tick(txEvent.timestamp, txEvent.blockNumber);

    const findings: Finding[] = [];

    const analyses = data.detector.releaseAnalyses();
    for (const { token, result: currentResult } of analyses) {
      const previousAnalysis = data.analysisByToken.get(token);

      const { isSpam, isFinalized } = currentResult.interpret();
      const { isUpdated, isChanged } = currentResult.compare(previousAnalysis);

      if (!isSpam && isChanged) {
        findings.push(createSpamRemoveFinding(token, currentResult.analysis));
      } else if (isSpam && isUpdated) {
        findings.push(createSpamUpdateFinding(token, currentResult.analysis, previousAnalysis!));
      } else if (isSpam) {
        findings.push(createSpamNewFinding(token, currentResult.analysis));
      }

      if (isFinalized) {
        data.analysisByToken.delete(token);
      } else {
        data.analysisByToken.set(token, currentResult.analysis);
      }
    }

    return findings;
  };
};

const provideHandleBlock = (data: DataContainer): HandleBlock =>
  async function handleBlock() {
    data.detector.logStats();
    return [];
  };

export default {
  initialize: provideInitialize(data, IS_DEVELOPMENT, IS_DEBUG),
  handleTransaction: provideHandleTransaction(data),
  handleBlock: provideHandleBlock(data),
};
