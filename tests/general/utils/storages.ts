import { Network } from 'forta-agent';

import { CsvStorage } from '../../../src/utils/storage';
import { TokenStandard } from '../../../src/types';
import { PATH_CONFIGS } from '../scripts/contants';
import { TokenTestResult } from '../test';
import { AnalysisContext } from '../../../src/analyzer/types';

export type BaseSpamToken = { contract: string };

export type CoinGeckoTokenType = 'nft' | 'coin';

export type CoinGeckoToken = {
  contract: string;
  name: string;
  id: string;
  type: CoinGeckoTokenType;
};

export type TokenRecord = {
  contract: string;
  deployer: string;
  type: TokenStandard | 'Unknown';
  blockNumber: number;
  timestamp: number;
  spam: boolean;
  airdrop: boolean;
};

export const getAlchemySpamTokenStorage = (network: Network) =>
  new CsvStorage<BaseSpamToken>(
    PATH_CONFIGS.SPAM_TOKENS_DIRECTORY,
    `alchemy-${network}.csv`,
    (v) => v,
    (v) => v,
  );

export const getCoingeckoGoodTokenStorage = (network: Network) =>
  new CsvStorage<CoinGeckoToken>(
    PATH_CONFIGS.GOOD_TOKENS_DIRECTORY,
    `coingecko-${network}.csv`,
    (v) => v as CoinGeckoToken,
    (v) => v,
  );

export const getDappRadarSpamTokenStorage = (network: Network) =>
  new CsvStorage<BaseSpamToken>(
    PATH_CONFIGS.SPAM_TOKENS_DIRECTORY,
    `dappradar-${network}.csv`,
    (v) => v,
    (v) => v,
  );

export const getTokenStorage = (network: Network, fileName = `tokens-${network}.csv`) =>
  new CsvStorage<TokenRecord>(
    PATH_CONFIGS.DATA_DIRECTORY,
    fileName,
    (v) => ({
      contract: v.contract,
      deployer: v.deployer,
      type: Number(v.type),
      timestamp: Number(v.timestamp),
      blockNumber: Number(v.blockNumber),
      spam: Boolean(Number(v.spam)),
      airdrop: Boolean(Number(v.airdrop)),
    }),
    (v) => ({ ...v, spam: Number(v.spam), airdrop: Number(v.airdrop) }),
  );

export const getTestTokenStorage = (network: Network) =>
  getTokenStorage(network, `samples-${network}.csv`);

export const getTestResultStorage = (network: Network) =>
  new CsvStorage<TokenTestResult>(
    PATH_CONFIGS.DATA_DIRECTORY,
    `test-results-${network}.csv`,
    (v) => ({
      ...v,
      type: Number(v.type),
      deployedAt: Number(v.deployedAt),
      isSpam: Boolean(Number(v.isSpam)),
      isSpamDetected: Boolean(Number(v.isSpamDetected)),
      isSpamAssessmentChanged: Boolean(Number(v.isSpamAssessmentChanged)),
      isAirdropped: Boolean(Number(v.isAirdropped)),
      isAirdropDetected: Boolean(Number(v.isAirdropDetected)),
      airdropDetectedAt: Number(v.airdropDetectedAt),
      spamDetectedAt: Number(v.spamDetectedAt),
      spamAssessmentChangedAt: Number(v.spamAssessmentChangedAt),
      finalizedAt: Number(v.finalizedAt),
    }),
    (v) => ({
      ...v,
      isSpam: Number(v.isSpam),
      isSpamDetected: Number(v.isSpamDetected),
      isSpamAssessmentChanged: Number(v.isSpamAssessmentChanged),
      isAirdropped: Number(v.isAirdropped),
      isAirdropDetected: Number(v.isAirdropDetected),
    }),
  );

export const getTestMetadataStorage = (network: Network) =>
  new CsvStorage<TokenTestResult & { analysis: AnalysisContext }>(
    PATH_CONFIGS.DATA_DIRECTORY,
    `test-metadata-${network}.csv`,
    (v) => ({
      ...v,
      type: Number(v.type),
      deployedAt: Number(v.deployedAt),
      isSpam: Boolean(Number(v.isSpam)),
      isSpamDetected: Boolean(Number(v.isSpamDetected)),
      isSpamAssessmentChanged: Boolean(Number(v.isSpamAssessmentChanged)),
      isAirdropped: Boolean(Number(v.isAirdropped)),
      isAirdropDetected: Boolean(Number(v.isAirdropDetected)),
      airdropDetectedAt: Number(v.airdropDetectedAt),
      spamDetectedAt: Number(v.spamDetectedAt),
      spamAssessmentChangedAt: Number(v.spamAssessmentChangedAt),
      finalizedAt: Number(v.finalizedAt),
      analysis: JSON.parse(v.analysis),
    }),
    (v) => ({
      ...v,
      isSpam: Number(v.isSpam),
      isSpamDetected: Number(v.isSpamDetected),
      isSpamAssessmentChanged: Number(v.isSpamAssessmentChanged),
      isAirdropped: Number(v.isAirdropped),
      isAirdropDetected: Number(v.isAirdropDetected),
      analysis: JSON.stringify(v.analysis),
    }),
  );
