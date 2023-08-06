import { Network } from 'forta-agent';
import { ethers } from 'ethers';
import Memoizer from '../src/utils/cache';
import DataStorage from '../src/storage';
import SqlDatabase from '../src/database';
import { JsonStorage } from '../src/utils/storage';
import { DATA_PATH as BOT_DATA_PATH, PUBLIC_RPC_URLS_BY_NETWORK } from '../src/contants';
import TokenProvider from '../src/utils/tokens';
import HoneyPotChecker, { EnsLeaderBoard } from '../src/utils/honeypot';
import TokenAnalyzer from '../src/analyzer/analyzer';
import { getLogger } from '../src/utils/logger';
import { CsvStorage } from 'forta-helpers';
import { TokenStandard } from '../src/types';
import { PreloadRow } from './indexer/preloaded-indexer';

export const Logger = getLogger({ colorize: true, console: true, file: true });

Logger.level = 'trace';

export function getPreloadStorage(dataPath: string, filePath: string) {
  return new CsvStorage<PreloadRow>(
    dataPath,
    filePath,
    (v) => ({
      ...v,
      type: Number(v.type) as TokenStandard,
      blockNumber: Number(v.blockNumber),
      timestamp: Math.floor(new Date(v.timestamp).valueOf() / 1000),
      blockNumbers: v.blockNumbers
        ? v.blockNumbers
            .slice(1, v.blockNumbers.length - 1)
            .split(' ')
            .map(Number)
        : [],
      hashes: v.hashes ? v.hashes.slice(1, v.hashes.length - 1).split(' ') : [],
    }),
    (v) => ({ ...v, hashes: v.hashes.join(' '), blockNumbers: v.blockNumbers.join(' ') }),
  );
}

export async function getTokenAnalyzer(
  database: SqlDatabase,
  provider: ethers.providers.JsonRpcBatchProvider,
) {
  const memoizer = new Memoizer();
  const storage = new DataStorage(database);
  const leaderStorage = new JsonStorage<any>(BOT_DATA_PATH, 'leaders.json');
  const honeypotStorage = new JsonStorage<string[]>(BOT_DATA_PATH, 'honeypots.json');
  const tokenStorage = new JsonStorage<any>(BOT_DATA_PATH, 'tokens.json');
  const tokenProvider = new TokenProvider(tokenStorage, Number.MAX_VALUE);
  const honeyPotChecker = new HoneyPotChecker(
    new EnsLeaderBoard(leaderStorage),
    new Set(await honeypotStorage.read()),
  );

  return new TokenAnalyzer(provider, honeyPotChecker, tokenProvider, storage, memoizer);
}

export async function filterGoodProviders(
  providers: ethers.providers.JsonRpcBatchProvider[],
): Promise<ethers.providers.JsonRpcBatchProvider[]> {
  const goodProviders: ethers.providers.JsonRpcBatchProvider[] = [];

  for (const provider of providers) {
    try {
      await provider.getNetwork();
      goodProviders.push(provider);
    } catch {}
  }

  Logger.warn(`Good RPC providers: ${goodProviders.length}`);

  return goodProviders;
}
