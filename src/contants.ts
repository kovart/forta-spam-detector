import path from 'path';
import { utils } from 'ethers';
import { Network } from 'forta-agent';
import dotenv from 'dotenv';

dotenv.config({
  path: path.resolve(__dirname, '../.env.public'),
});

import Erc20Abi from './abi/erc20.json';
import Erc165Abi from './abi/erc165.json';
import Erc721Abi from './abi/erc721.json';
import Erc1155Abi from './abi/erc1155.json';
import { TokenStandard } from './types';

export const erc165Iface = new utils.Interface(Erc165Abi);
export const erc20Iface = new utils.Interface(Erc20Abi);
export const erc721Iface = new utils.Interface(Erc721Abi);
export const erc1155Iface = new utils.Interface(Erc1155Abi);

export const IS_DEBUG = process.env.DEBUG === '1';
export const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
export const DEBUG_TARGET_TOKEN = (process.env.TARGET_TOKEN || '').toLowerCase();
export const PROVIDER_CONCURRENCY = IS_DEVELOPMENT ? 40 : 2;
export const FETCH_CONCURRENCY = IS_DEVELOPMENT ? 50 : 25;

export const DATA_PATH = path.resolve(__dirname, '../data');

export const DB_FOLDER_PATH = path.resolve(__dirname);
export const DB_FILE_PATH = path.resolve(DB_FOLDER_PATH, './storage.db');

export const INTERFACE_ID_BY_TYPE = {
  [TokenStandard.Erc20]: '0x36372b07',
  [TokenStandard.Erc721]: '0x5b5e139f',
  [TokenStandard.Erc1155]: '0xd9b67a26',
};

export const PUBLIC_RPC_URLS_BY_NETWORK = {
  [Network.MAINNET]: [
    'https://rpc.ankr.com/eth',
    'https://eth-rpc.gateway.pokt.network',
    'https://1rpc.io/eth',
  ],
  [Network.POLYGON]: ['https://polygon-rpc.com'],
  [Network.BSC]: ['https://rpc.ankr.com/bsc'],
  [Network.AVALANCHE]: ['https://rpc.ankr.com/avalanche'],
  [Network.OPTIMISM]: ['https://mainnet.optimism.io'],
  [Network.FANTOM]: ['https://rpc.fantom.network'],
  [Network.ARBITRUM]: ['https://rpc.ankr.com/arbitrum'],
} as Record<Network, string[]>;

export const FALSE_FINDINGS_URL =
  'https://raw.githubusercontent.com/kovart/forta-spam-detector/main/data/false-findings.json';

export const BURN_ADDRESSES = new Set(
  [
    '0x00000000000000000000045261d4ee77acdb3286',
    '0x0123456789012345678901234567890123456789',
    '0x1234567890123456789012345678901234567890',
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',
    '0x4444444444444444444444444444444444444444',
    '0x5555555555555555555555555555555555555555',
    '0x6666666666666666666666666666666666666666',
    '0x7777777777777777777777777777777777777777',
    '0x8888888888888888888888888888888888888888',
    '0x9999999999999999999999999999999999999999',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '0xdead000000000000000042069420694206942069',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    '0xffffffffffffffffffffffffffffffffffffffff',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '0x000000000000000000000000000000000000dEaD',
  ].map((a) => a.toLowerCase()),
);
