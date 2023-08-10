import axios from 'axios';
import { ethers } from 'ethers';
import { Network } from 'forta-agent';
import { Mutex } from 'async-mutex';
import { random } from 'lodash';

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
  private ttl: number;

  private storage: JsonStorage<TokenProviderCache>;

  constructor(storage: JsonStorage<TokenProviderCache>, ttl: number = 12 * 60 * 60 * 1000) {
    this.storage = storage;
    this.mutex = new Mutex();
    this.ttl = ttl;
  }

  public async getList(): Promise<TokenRecord[]> {
    return await this.mutex.runExclusive(async () => {
      if (!this.cache) {
        Logger.debug('There are no token cache');
        this.cache = await this.storage.read();
        if (this.cache) {
          Logger.info('Cache has been successfully loaded from local storage.');
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
          Logger.error(e, 'Caught fetch error. Fallback to the cached tokens');
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
    // wait a bit and then fetch NFTs
    await delay(10 * 1000);
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
    let limit = 100;
    let lastResponse: any[] | null = null;
    while (!lastResponse || lastResponse.length === limit) {
      const response = await retry(
        () =>
          axios.get<CoinGeckoNft[]>(COINGECKO_NFT_API_URL, {
            params: {
              per_page: limit,
              page: page,
            },
          }),
        { wait: 5 * 60 * 1000, attempts: 3 },
      );

      lastResponse = response.data;
      nfts.push(...response.data);
      page++;

      Logger.debug(`[${page}] Fetched NFTs: ${nfts.length}`);

      await delay(10 * 1000);
    }

    Logger.debug(`Successfully fetched ${nfts.length} NFTs.`);

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

    Logger.info(`Monitored NFTs: ${tokens.length}.`);

    await this.updateMetadata(tokens);

    return tokens;
  }

  private async fetchCoins(): Promise<TokenRecord[]> {
    Logger.debug('Fetching coins from CoinGecko...');

    const { data: coins } = await retry(() => axios.get<CoinGeckoCoin[]>(COINGECKO_COIN_API_URL), {
      wait: 5 * 60 * 1000,
      attempts: 3,
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

    Logger.info(`Monitored coins: ${coins.length}.`);

    await this.updateMetadata(tokens);

    return tokens;
  }

  private async fetchTokenMetadata(address: string, network: Network) {
    const rpcUrls = PUBLIC_RPC_URLS_BY_NETWORK[network];

    if (!rpcUrls) throw new Error(`No RPC urls for network: ${network}`);

    for (const rpcUrl of rpcUrls) {
      Logger.debug(`Fetching metadata with the following RPC url (${Network[network]}): ${rpcUrl}`);

      try {
        const provider = new ethers.providers.JsonRpcBatchProvider(rpcUrl);
        const contract = new ethers.Contract(address, erc20Iface, provider);

        const [symbol, name] = await retry(
          () => Promise.all([contract.symbol(), contract.name()]),
          { wait: random(1, 4) * 1000 },
        );

        return { symbol, name };
      } catch (e) {
        Logger.debug(e, 'Cannot read token metadata');
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
    const maxFailedTokens = 8;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      let tokenCache: TokenRecord | undefined = undefined;

      for (const address of Object.values(token.deployments)) {
        // check if it is a future deployment (e.g. PayPal USD)
        if (address == '') {
          break;
        }

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
          Logger.debug(`Cannot find deployed contract for token ${token.name} (${token.symbol})`, {
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
          Logger.debug('Failed to get token metadata.');
          failedTokens++;
          if (failedTokens >= maxFailedTokens) {
            Logger.error(`Already failed ${failedTokens} tokens. Break the updating process`);
            break;
          } else {
            // Some tokens return metadata in a slightly different standard.
            // For example, this token returns bytes instead of strings, which causes an error when retrieving this data:
            // https://etherscan.io/address/0x0d88ed6e74bbfd96b831231638b66c05571e824f#readContract
            Logger.debug('Skip token');
          }
        }
      }
    }
  }
}

export default TokenProvider;
