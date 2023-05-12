import axios from 'axios';
import { ethers } from 'ethers';
import { Network } from 'forta-agent';
import { groupBy } from 'lodash';
import { Mutex } from 'async-mutex';

import Logger from './logger';
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

export const COINGECKO_PLATFORM_ID_BY_NETWORK = {} as Record<Network, CoinGeckoPlatformId>;
Object.entries(NETWORK_BY_COINGECKO_PLATFORM_ID).forEach(
  // @ts-ignore
  ([platformId, network]) => (COINGECKO_PLATFORM_ID_BY_NETWORK[network] = platformId),
);

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
  private ttl: number = 6 * 60 * 60 * 1000; // 6h

  private storage: JsonStorage<TokenProviderCache>;

  constructor(storage: JsonStorage<TokenProviderCache>) {
    this.storage = storage;
    this.mutex = new Mutex();
  }

  public async getList(): Promise<TokenRecord[]> {
    return await this.mutex.runExclusive(async () => {
      if (!this.cache) {
        Logger.debug('There are no token cache');
        this.cache = await this.storage.read();
        if (this.cache) {
          Logger.debug('Cache has been successfully loaded');
        }
      }

      if (this.cache && Date.now() - this.cache.updatedAt <= this.ttl) {
        Logger.debug('Using tokens cache');
        return this.cache.tokens;
      }

      try {
        await this.fetch();
      } catch (e) {
        if (this.cache) {
          Logger.error('Caught fetch error. Fallback to the cached version', { error: e });
          return this.cache.tokens;
        }

        throw e;
      }

      await this.storage.write(this.cache!);
      Logger.debug('Tokens have been successfully fetched and cached');

      return this.cache!.tokens;
    });
  }

  private async fetch() {
    const coins = await this.fetchCoins();
    const nfts = await this.fetchNfts();

    this.cache = {
      updatedAt: Date.now(),
      tokens: [...coins, ...nfts],
    };
  }

  private async fetchNfts(): Promise<TokenRecord[]> {
    Logger.debug('Fetching NFTs from CoinGecko...');

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

      Logger.debug(`[${nfts.length}/${total}] Fetched page: ${page}`);

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
    const similarTokens = groupBy(tokens, (t) => t.name + t.symbol + t.type);
    for (const tokens of Object.values(similarTokens)) {
      mergedTokens.push({
        ...tokens[0],
        deployments: Object.assign({}, ...tokens.map((t) => t.deployments)),
      });
    }

    await this.updateMetadata(mergedTokens);

    return mergedTokens;
  }

  private async fetchCoins(): Promise<TokenRecord[]> {
    Logger.debug('Fetching coins from CoinGecko...');

    const { data: coins } = await retry(() => axios.get<CoinGeckoCoin[]>(COINGECKO_COIN_API_URL), {
      wait: 2 * 60 * 1000,
      attempts: 5,
    });

    Logger.debug(`Coins have been successfully fetched: ${coins.length}`);

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

      if (Object.keys(deployments).length === 0) {
        Logger.warn(`Skipping coin due to missing contract data: ${coin.name} (${coin.symbol})`);
        Logger.debug(coin.platforms);
        continue;
      }

      tokens.push({
        name: coin.name,
        symbol: coin.symbol,
        type: 'coin',
        deployments: deployments,
      });
    }

    await this.updateMetadata(tokens);

    return tokens;
  }

  private async fetchTokenMetadata(address: string, network: Network) {
    const rpcUrls = PUBLIC_RPC_URLS_BY_NETWORK[network];

    if (!rpcUrls) throw new Error(`No RPC urls for network: ${network}`);

    for (const rpcUrl of rpcUrls) {
      Logger.debug(`Fetching metadata with the following RPC url (${Network[network]}): ${rpcUrl}`);

      const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(address, erc20Iface, provider);

      try {
        const symbol: string = await retry(() => contract.symbol());
        const name: string = await retry(() => contract.name());

        return { symbol, name };
      } catch (e) {
        Logger.error('Cannot read token metadata', { error: e });
        // ignore, use the next rpc url
      }
    }

    throw new Error(
      `Cannot fetch token metadata using the following RPC urls: ${rpcUrls.join(', ')}`,
    );
  }

  private async updateMetadata(tokens: TokenRecord[]) {
    // Unfortunately, CoinGecko returns not quite correct names of tokens.
    // For example the contract of the "Tether" token returns "Tether USD" when you call name() function,
    // however CoinGecko returns just "Tether".
    // https://etherscan.io/address/0xdac17f958d2ee523a2206206994597c13d831ec7#readContract

    const cacheEntries = (this.cache?.tokens || [])
      .map((t) =>
        Object.values(t.deployments).map((address) => [address, t] as [string, TokenRecord]),
      )
      .flat();
    const tokenCacheByAddress = new Map<string, TokenRecord>(cacheEntries);

    // Get correct values for symbol() and name()
    let failedTokens = 0;
    const maxFailedTokens = 3;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      let tokenCache: TokenRecord | undefined = undefined;

      for (const address of Object.values(token.deployments)) {
        tokenCache = tokenCacheByAddress.get(address);
        if (tokenCache) break;
      }

      const log = (msg: string) => Logger.debug(`[${i}/${tokens.length}] ${msg}`);

      if (tokenCache) {
        token.symbol = tokenCache.symbol;
        token.name = tokenCache.name;

        log(`Using cache data`);
      } else {
        const deployment = Object.entries(token.deployments).find((v) => v[1]);

        if (!deployment) {
          Logger.error(`Cannot find deployed contract for token ${token.name} (${token.symbol})`, {
            tokenDeployments: token.deployments,
          });
          continue;
        }

        const [network, tokenAddress] = deployment;

        log(`Updating token metadata (${tokenAddress}): ${token.name} (${token.symbol})`);

        try {
          const meta = await this.fetchTokenMetadata(tokenAddress, Number(network) as Network);
          log(
            `Token metadata updated. Before: ${token.name} (${token.symbol}). After: ${meta.name} (${meta.symbol}).`,
          );
          token.symbol = meta.symbol;
          token.name = meta.name;
          failedTokens = 0;
        } catch (e) {
          Logger.error('Failed to get token metadata.');
          failedTokens++;
          if (failedTokens >= maxFailedTokens) {
            Logger.error(`Already failed ${failedTokens} tokens. Break the updating process`);
            break;
          } else {
            // Some tokens return metadata in a slightly different standard.
            // For example, this token returns bytes instead of strings, which causes an error when retrieving this data:
            // https://etherscan.io/address/0x0d88ed6e74bbfd96b831231638b66c05571e824f#readContract
            Logger.warn('Skip token');
          }
        }
      }
    }
  }
}

export default TokenProvider;
