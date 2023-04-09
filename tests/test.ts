import { ethers } from 'ethers';
import { Network, TransactionEvent } from 'forta-agent';
import dotenv from 'dotenv';

import Logger from '../src/utils/logger';
import AirdropModule from '../src/analyzer/modules/airdrop';
import { getTestMetadataStorage, getTestResultStorage, TokenRecord } from './utils/storages';
import { TokenContract, TokenStandard } from '../src/types';
import { AnalysisContext } from '../src/analyzer/types';
import { SpamDetector } from '../src/detector';
import { delay } from './utils/utils';
import { PUBLIC_RPC_URLS_BY_NETWORK } from '../src/contants';
import {
  formatDate,
  generateBlocks,
  getErc1155TxEvents,
  getErc20TxEvents,
  getErc721TxEvents,
  readTokens,
} from './helpers';
import { PROVIDER_RPC_URL } from './scripts/contants';

dotenv.config();

Logger.level = 'debug';

const TICK_INTERVAL = 12 * 60 * 60; // 12h
const OBSERVATION_TIME = 4 * 31 * 24 * 60 * 60; // 4 months
const NETWORK = Network.MAINNET;
const RPC_URL = PROVIDER_RPC_URL || PUBLIC_RPC_URLS_BY_NETWORK[NETWORK][0];

console.log(`RPC URL: ${RPC_URL}`);

export type TokenTestResult = {
  type: TokenStandard;
  contract: string;
  deployedAt: number;
  isSpam: boolean;
  isSpamDetected: boolean;
  isSpamAssessmentChanged: boolean;
  isAirdropped: boolean;
  isAirdropDetected: boolean;
  spamDetectedAt: number;
  spamAssessmentChangedAt: number;
  airdropDetectedAt: number;
  finalizedAt: number;
};

async function testTokens(
  tokens: TokenRecord[],
  fetch: (token: TokenRecord) => Promise<TransactionEvent[]>,
) {
  const provider = new ethers.providers.JsonRpcBatchProvider(RPC_URL);
  const detector = new SpamDetector(provider, 0);
  const resultStorage = getTestResultStorage(NETWORK);
  const metadataStorage = getTestMetadataStorage(NETWORK);

  const testedTokens = await resultStorage.read();
  const testedTokenSet = new Set<string>(testedTokens.map((t) => t.contract));

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (testedTokenSet.has(token.contract)) {
      console.log(`Already tested token, skip: ${token.contract}`);
      continue;
    }

    const tokenContract: TokenContract = {
      type: token.type as TokenStandard,
      address: token.contract,
      blockNumber: token.blockNumber,
      timestamp: token.timestamp,
      deployer: token.deployer,
    };

    detector.addTokenToWatchList(tokenContract.type as TokenStandard, tokenContract);

    const events = await fetch(token);

    let isSpamDetected = false;
    let isAssessmentChanged = false;
    let isAirdropDetected = false;
    let spamDetectedAt: number = -1;
    let assessmentChangedAt: number = -1;
    let airdropDetectedAt: number = -1;
    let finalizedAt: number = -1;
    let previousAnalysis: AnalysisContext | undefined = undefined;

    const startTimestamp = token.timestamp;
    const endTimestamp = startTimestamp + OBSERVATION_TIME + TICK_INTERVAL; // observation time + 1 tick

    for (const generatedBlock of generateBlocks(
      events,
      token.blockNumber,
      startTimestamp,
      endTimestamp,
      TICK_INTERVAL,
    )) {
      const { block, blockCounter, eventCounter, blockCount } = generatedBlock;
      const time = formatDate(block.timestamp);

      const log = (msg: string) =>
        console.log(
          `[${i}/${tokens.length}][ERC${token.type}|${token.contract}]` +
            `[T${eventCounter}/${events.length}]` +
            `[B${blockCounter}/${blockCount}] ${time} | ${msg}`,
        );

      for (const event of block.events) {
        detector.handleTxEvent(event);
      }

      detector.tick(block.timestamp, block.number);
      await detector.wait();
      const analyses = detector.releaseAnalyses();

      if (analyses.length === 0) {
        log(`No analyses!!!`);
        await delay(60 * 1000);
        continue;
      }

      if (analyses.length > 1) {
        log(`Something went wrong, more than one analysis: ${analyses.length}`);
      }

      // Checking the result

      const { result } = analyses[0];
      const { isSpam, isFinalized } = result.interpret();

      if (airdropDetectedAt === -1 && result.analysis[AirdropModule.Key]?.detected) {
        isAirdropDetected = true;
        airdropDetectedAt = block.timestamp;
      }

      if (spamDetectedAt === -1 && isSpam) {
        spamDetectedAt = block.timestamp;
      }

      if (isSpamDetected && !isSpam) {
        log(`Assessment changed`);
        assessmentChangedAt = block.timestamp;
        isAssessmentChanged = true;
      }

      isSpamDetected = isSpam;

      const format = (str: string | boolean, good: boolean) =>
        `${good ? '\u001b[32m' : '\u001b[31m'}${String(str).toUpperCase()}\u001b[0m`;

      log(
        `Spam: ${format(isSpam, isSpam == token.spam)}, ` +
          `Airdrop: ${String(isAirdropDetected).toUpperCase()}`,
      );

      if (isFinalized) {
        finalizedAt = block.timestamp;
        log(`Finalized.`);
        break;
      }

      previousAnalysis = result.analysis;
    }

    const result: TokenTestResult = {
      type: token.type as TokenStandard,
      contract: token.contract,
      isSpam: token.spam,
      isSpamDetected: isSpamDetected,
      isSpamAssessmentChanged: isAssessmentChanged,
      isAirdropped: token.airdrop,
      isAirdropDetected: isAirdropDetected,
      deployedAt: token.timestamp,
      spamDetectedAt: spamDetectedAt,
      airdropDetectedAt: airdropDetectedAt,
      spamAssessmentChangedAt: assessmentChangedAt,
      finalizedAt: finalizedAt,
    };

    await resultStorage.append(result);
    await metadataStorage.append({ ...result, analysis: previousAnalysis! });

    detector.deleteToken(tokenContract);
  }
}

async function main() {
  const tokens = (await readTokens()).filter((t) => t.type !== 'Unknown');

  await testTokens(
    tokens.filter((t) => t.type === TokenStandard.Erc20),
    getErc20TxEvents,
  );
  await testTokens(
    tokens.filter((t) => t.type === TokenStandard.Erc721),
    getErc721TxEvents,
  );
  await testTokens(
    tokens.filter((t) => t.type === TokenStandard.Erc1155),
    getErc1155TxEvents,
  );
}

main().catch((e) => {
  console.error(e);
  return 1;
});
