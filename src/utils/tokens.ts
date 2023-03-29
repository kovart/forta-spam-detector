import axios from 'axios';
import { ethers } from 'ethers';
import { Network } from 'forta-agent';
import { groupBy } from 'lodash';
import { Mutex } from 'async-mutex';

import { JsonStorage } from './storage';
import { delay, retry } from './helpers';
import { erc20Iface, PUBLIC_RPC_URLS_BY_NETWORK } from '../contants';

export enum CoinGeckoPlatformId {
  MAINNET = 'ethereum',
  POLYGON = 'polygon-pos',
  BSC = 'binance-smart-chain',
  FANTOM = 'fantom',
  OPTIMISM = 'optimistic-ethereum',
  ARBITRUM = 'arbitrum-nova',
}

export type CoinGeckoNft = {
  id: string;
  name: string;
  symbol: string;
  contract_address: string;
  asset_platform_id: CoinGeckoPlatformId;
};

export type CoinGeckoCoin = {
  id: string;
  name: string;
  symbol: string;
  platforms: {
    [id in CoinGeckoPlatformId]: string;
  };
};

// https://www.coingecko.com/en/api/documentation

const COINGECKO_COIN_API_URL = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';
const COINGECKO_NFT_API_URL = 'https://api.coingecko.com/api/v3/nfts/list';

export const NETWORK_BY_COINGECKO_PLATFORM_ID: Record<CoinGeckoPlatformId, Network> = {
  [CoinGeckoPlatformId.MAINNET]: Network.MAINNET,
  [CoinGeckoPlatformId.BSC]: Network.BSC,
  [CoinGeckoPlatformId.POLYGON]: Network.POLYGON,
  [CoinGeckoPlatformId.FANTOM]: Network.FANTOM,
  [CoinGeckoPlatformId.ARBITRUM]: Network.ARBITRUM,
  [CoinGeckoPlatformId.OPTIMISM]: Network.OPTIMISM,
};

// @ts-ignore
export const COINGECKO_PLATFORM_ID_BY_NETWORK: Record<Network, CoinGeckoPlatformId> = {};

export type TokenRecord = {
  name: string;
  symbol: string;
  deployments: { [network: string]: string };
  type: 'coin' | 'nft';
};

export type TokenProviderCache = {
  updatedAt: number;
  tokens: TokenRecord[];
};

class TokenProvider {
  private mutex: Mutex;
  private cache: TokenProviderCache | null = null;
  private ttl: number = 24 * 60 * 60 * 1000; // 1d

  private storage: JsonStorage<TokenProviderCache>;

  constructor(storage: JsonStorage<TokenProviderCache>) {
    this.storage = storage;
    this.mutex = new Mutex();
  }

  public async getList(): Promise<TokenRecord[]> {
    return await this.mutex.runExclusive(async () => {
      if (!this.cache) this.cache = await this.storage.read();
      if (this.cache && this.cache.updatedAt + this.ttl <= Date.now()) return this.cache.tokens;

      try {
        await this.fetch();
      } catch (e) {
        if (this.cache) {
          console.error('Caught fetch error. Fallback to the cached version', e);
          return this.cache.tokens;
        }

        throw e;
      }

      await this.storage.write(this.cache!);

      return this.cache!.tokens;
    });
  }

  public async fetch() {
    const coins = await this.fetchCoins();
    const nfts = await this.fetchNfts();

    this.cache = {
      updatedAt: Date.now(),
      tokens: [...coins, ...nfts],
    };
  }

  private async fetchNfts(): Promise<TokenRecord[]> {
    let nfts: CoinGeckoNft[] = [];

    let page = 0;
    let perPage = 100;
    let total = Infinity;
    while (nfts.length < total) {
      const response = await axios.get<CoinGeckoNft[]>(COINGECKO_NFT_API_URL, {
        params: {
          per_page: perPage,
          page: page,
        },
      });

      total = Number(response.headers?.total || 0);
      nfts.push(...response.data);
      page++;

      await delay(10 * 1000);
    }

    const tokens: TokenRecord[] = nfts
      .filter((nft) => NETWORK_BY_COINGECKO_PLATFORM_ID[nft.asset_platform_id])
      .map((nft) => ({
        name: nft.name,
        symbol: nft.symbol,
        deployments: {
          [NETWORK_BY_COINGECKO_PLATFORM_ID[nft.asset_platform_id]]: nft.contract_address,
        },
        type: 'nft',
      }));

    // Merge similar tokens
    const mergedTokens: TokenRecord[] = [];
    const similarTokens = groupBy(tokens, (t) => this.getTokenHash(t));
    for (const tokens of Object.values(similarTokens)) {
      mergedTokens.push({
        ...tokens[0],
        deployments: Object.assign({}, ...tokens.map((t) => t.deployments)),
      });
    }

    return mergedTokens;
  }

  private async fetchCoins(): Promise<TokenRecord[]> {
    const { data: coins } = await retry(() => axios.get<CoinGeckoCoin[]>(COINGECKO_COIN_API_URL), {
      wait: 2 * 60 * 1000,
      attempts: 5,
    });

    const tokens: TokenRecord[] = [];

    for (const coin of coins) {
      const platformEntries = Object.entries(coin.platforms).filter(
        ([platformId]) => NETWORK_BY_COINGECKO_PLATFORM_ID[platformId as CoinGeckoPlatformId],
      );

      if (platformEntries.length === 0) continue;

      // network -> address
      const deployments: { [network: string]: string } = {};
      platformEntries.forEach(
        ([platformId, address]) =>
          (deployments[NETWORK_BY_COINGECKO_PLATFORM_ID[platformId as CoinGeckoPlatformId]] =
            address),
      );

      tokens.push({
        name: coin.name,
        symbol: coin.symbol,
        type: 'coin',
        deployments: deployments,
      });
    }

    // Unfortunately, Coingecko returns not quite correct names of tokens.
    // For example the contract of the "Tether" token returns "Tether USD" when you call name(),
    // while Coingecko returns just "Tether".
    // https://etherscan.io/address/0xdac17f958d2ee523a2206206994597c13d831ec7#readContract

    const tokenCashByHash = new Map<string, TokenRecord>(
      (this.cache?.tokens || []).map((t) => [this.getTokenHash(t), t]),
    );

    // Get correct values for symbol() and name()
    for (const token of tokens) {
      const tokenCache = tokenCashByHash.get(this.getTokenHash(token));

      if (tokenCache) {
        token.symbol = tokenCache.symbol;
        token.name = tokenCache.name;
      } else {
        const deployment = Object.entries(token.deployments)[0];
        const meta = await this.fetchTokenMetadata(deployment[1], Number(deployment[0]) as Network);
        token.symbol = meta.symbol;
        token.name = meta.name;
      }
    }

    return tokens;
  }

  async fetchTokenMetadata(address: string, network: Network) {
    const rpcUrls = PUBLIC_RPC_URLS_BY_NETWORK[network];

    if (!rpcUrls) throw new Error(`No RPC urls for network: ${network}`);

    for (const rpcUrl of rpcUrls) {
      const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(address, erc20Iface, provider);

      try {
        const symbol: string = await contract.symbol();
        const name: string = await contract.name();

        return { symbol, name };
      } catch (e) {
        console.error(e);
        // ignore, use the next rpc url
      }
    }

    throw new Error(
      `Cannot fetch token metadata using the following rpc urls: ${rpcUrls.join(', ')}`,
    );
  }

  getTokenHash(t: { name: string; symbol: string }) {
    return `${t.name} (${t.symbol})`;
  }
}

export default TokenProvider;
