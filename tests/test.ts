import { ethers } from 'ethers';
import { Network } from 'forta-agent';

import Logger from '../src/utils/logger';
import AirdropModule from '../src/analyzer/modules/airdrop';
import { getTestMetadataStorage, getTestResultStorage, TokenRecord } from './utils/storages';
import { TokenContract, TokenStandard } from '../src/types';
import { AnalysisContext } from '../src/analyzer/types';
import { SpamDetector } from '../src/detector';
import { delay } from './utils/utils';
import { PUBLIC_RPC_URLS_BY_NETWORK } from '../src/contants';
import { formatDate, generateBlocks, getErc20TxEvents, readTokens } from './helpers';

const TICK_INTERVAL = 12 * 60 * 60; // 12h
const OBSERVATION_TIME = 4 * 31 * 24 * 60 * 60; // 4 months
const NETWORK = Network.MAINNET;
const PUBLIC_RPC = PUBLIC_RPC_URLS_BY_NETWORK[NETWORK][0];
// Temp solution to speedup first-time tests
const LIMITER = 800;

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

async function testErc20Tokens(tokens: TokenRecord[]) {
  const provider = new ethers.providers.JsonRpcBatchProvider(PUBLIC_RPC);
  const detector = new SpamDetector(provider, 0);
  const resultStorage = getTestResultStorage(NETWORK);
  const metadataStorage = getTestMetadataStorage(NETWORK);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const tokenContract: TokenContract = {
      type: token.type as TokenStandard,
      address: token.contract,
      blockNumber: token.blockNumber,
      timestamp: token.timestamp,
      deployer: token.deployer,
    };

    detector.addTokenToWatchList(tokenContract.type as TokenStandard, tokenContract);

    const events = await getErc20TxEvents(token);

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
      const { block, blockCounter, eventCounter, totalBlocks } = generatedBlock;
      const time = formatDate(block.timestamp);

      const log = (msg: string) =>
        console.log(
          `[${i}/${tokens.length}][ERC${token.type}|${token.contract}]` +
            `[E${eventCounter}/${events.length}][B${blockCounter}/${totalBlocks}] ${time} | ${msg}`,
        );

      const t0 = performance.now();

      for (const event of block.events) {
        detector.handleTxEvent(event);
      }

      detector.tick(block.timestamp, block.number);

      const t1 = performance.now();
      Logger.debug(`Block handled in ${t1 - t0}ms`);
      await detector.wait();
      Logger.debug(`Waiting ${performance.now() - t0}ms`);

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

      if (result.analysis[AirdropModule.Key]?.detected) {
        isAirdropDetected = true;
        airdropDetectedAt = block.timestamp;
        log(`Airdrop detected`);
      }

      if (isSpamDetected && !isSpam) {
        log(`Assessment changed`);
        assessmentChangedAt = block.timestamp;
        isAssessmentChanged = true;
      }

      if (isSpam) {
        spamDetectedAt = block.timestamp;

        if (!isSpamDetected) {
          log(`Spam detected`);
        }
      }

      isSpamDetected = isSpam;

      log(`Spam: ${isSpam} (${token.spam}) | Airdrop: ${isAirdropDetected} (${token.airdrop}).`);

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

  await testErc20Tokens(tokens.filter((t) => t.type === TokenStandard.Erc20));
}

main().catch((e) => {
  console.error(e);
  return 1;
});
