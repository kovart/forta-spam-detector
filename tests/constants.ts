import { Network } from 'forta-agent';

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