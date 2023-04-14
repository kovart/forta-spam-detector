import path from 'path';
import { Network } from 'forta-agent';
import dayjs from 'dayjs';
import dotenv from 'dotenv';
import duration from 'dayjs/plugin/duration';

import {
  COINGECKO_PLATFORM_ID_BY_NETWORK,
  NETWORK_BY_COINGECKO_PLATFORM_ID,
} from '../../../src/utils/tokens';

dotenv.config({
  path: path.resolve(__dirname, '../.env.private'),
});
dayjs.extend(duration);

export const DUNE_USERS: [string, string][] = JSON.parse(process.env.DUNE_USERS || '[]');

export const TARGET_NETWORKS = [Network.MAINNET];
export const PROVIDER_RPC_URL = process.env.PROVIDER_RPC_URL;

export const EVENTS_INTERVAL = dayjs.duration(4, 'month');

export const PATH_CONFIGS = {
  DATA_DIRECTORY: path.resolve(__dirname, '../data/'),
  GOOD_TOKENS_DIRECTORY: path.resolve(__dirname, '../data/', 'good-tokens'),
  SPAM_TOKENS_DIRECTORY: path.resolve(__dirname, '../data/', 'spam-tokens'),
  QUERIES_DIRECTORY: path.resolve(__dirname, '../queries/'),
  QUERY_TEMPLATES_DIRECTORY: path.resolve(__dirname, '../queries/', 'templates'),
};

Object.entries(NETWORK_BY_COINGECKO_PLATFORM_ID).forEach(
  // @ts-ignore
  ([platformId, network]) => (COINGECKO_PLATFORM_ID_BY_NETWORK[network] = platformId),
);

export const DUNE_NETWORK_BY_NETWORK: Record<Network, string> = {
  [Network.MAINNET]: 'ethereum',
  [Network.BSC]: 'bnb',
  [Network.POLYGON]: 'polygon',
  [Network.ARBITRUM]: 'arbitrum',
  [Network.AVALANCHE]: 'avalanche_c',
  [Network.OPTIMISM]: 'optimism',
  [Network.FANTOM]: 'fantom',

  [Network.ROPSTEN]: '',
  [Network.RINKEBY]: '',
  [Network.GOERLI]: '',
};
