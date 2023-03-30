import path from 'path';
import { utils } from 'ethers';
import { Network } from 'forta-agent';

import Erc20Abi from './abi/erc20.json';
import Erc165Abi from './abi/erc165.json';
import Erc721Abi from './abi/erc721.json';
import Erc1155Abi from './abi/erc1155.json';
import { TokenStandard } from './types';

export const erc165Iface = new utils.Interface(Erc165Abi);
export const erc20Iface = new utils.Interface(Erc20Abi);
export const erc721Iface = new utils.Interface(Erc721Abi);
export const erc1155Iface = new utils.Interface(Erc1155Abi);

export const DATA_PATH = path.resolve(__dirname, '../data');

export const INTERFACE_ID_BY_TYPE = {
  [TokenStandard.Erc20]: '0x36372b07',
  [TokenStandard.Erc721]: '0x5b5e139f',
  [TokenStandard.Erc1155]: '0xd9b67a26',
};

export const PUBLIC_RPC_URLS_BY_NETWORK = {
  [Network.MAINNET]: ['https://rpc.ankr.com/eth'],
  [Network.POLYGON]: ['https://polygon-rpc.com'],
  [Network.BSC]: ['https://rpc.ankr.com/bsc'],
  [Network.AVALANCHE]: ['https://rpc.ankr.com/avalanche'],
  [Network.OPTIMISM]: ['https://mainnet.optimism.io'],
  [Network.FANTOM]: ['https://rpc.fantom.network'],
  [Network.ARBITRUM]: ['https://rpc.ankr.com/arbitrum'],
} as Record<Network, string[]>;
