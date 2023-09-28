import axios from 'axios';
import { BigNumber, ethers } from 'ethers';
import { Network } from 'forta-agent';
import { Mutex } from 'async-mutex';

import { JsonStorage } from './storage';
import Logger from './logger';
import { retry } from './helpers';
import { PUBLIC_RPC_URLS_BY_NETWORK } from '../contants';

const PUBLIC_ENS_PROVIDER = new ethers.providers.JsonRpcBatchProvider(
  PUBLIC_RPC_URLS_BY_NETWORK[Network.MAINNET][0],
);

type EnsLeader = {
  ens: string; // e.g. "vitalik.eth"
  followers: number;
  verified: boolean; // Is Twitter account verified?
  ranking: number;
};

export type HoneypotAnalysisMetadata = {
  HardCodedAccount: {
    detected: boolean;
  };
  HighBalance?: {
    detected: boolean;
    balance: string;
  };
  VeryHighBalance?: {
    detected: boolean;
    balance: string;
  };
  EnsRegistered?: {
    detected: boolean;
    name?: string;
  };
  CEX?: {
    detected: boolean;
    nonce: number;
  };
  ManyTwitterFollowers?: {
    detected: boolean;
    followers?: number;
  };
};

export type HoneypotAnalysisResult = {
  isHoneypot: boolean;
  metadata: HoneypotAnalysisMetadata;
};

type EnsLeaderBoardCache = {
  updatedAt: number;
  leaders: EnsLeader[];
};

// https://ethleaderboard.xyz/
export class EnsLeaderBoard {
  static ENS_LEADERBOARD_API = 'https://ethleaderboard.xyz/api/frens';
  static UPDATE_INTERVAL = 14 * 24 * 60 * 60 * 1000; // 14d

  public updatedAt = -1;
  public leaderByEns = new Map<string, EnsLeader>();

  private mutex = new Mutex();

  constructor(private storage: JsonStorage<EnsLeaderBoardCache>) {}

  async get(name: string) {
    return this.mutex.runExclusive(async () => {
      if (this.updatedAt === -1) {
        const cache = await this.storage.read();
        if (cache) {
          Logger.debug('Reading ENS leaderboard cache.');
          this.updatedAt = cache.updatedAt;
          this.leaderByEns = new Map(cache.leaders.map((l) => [l.ens, l]));
        }
      }

      if (this.updatedAt + EnsLeaderBoard.UPDATE_INTERVAL < Date.now()) {
        await this.update();
        this.updatedAt = Date.now();
        await this.storage.write({
          updatedAt: this.updatedAt,
          leaders: [...this.leaderByEns.values()],
        });
      }

      return this.leaderByEns.get(name);
    });
  }

  async update() {
    const accounts = await this.fetchData();

    if (accounts.length === 0) throw new Error('Leaderboard cannot be empty');

    this.leaderByEns.clear();
    for (const account of accounts) {
      this.leaderByEns.set(account.ens, account);
    }
  }

  async fetchData() {
    Logger.debug('Fetching ENS leaderboard...');

    const accounts: EnsLeader[] = [];

    const limit = 100;
    const maxPage = 18;

    let page = 0;
    while (true) {
      const { data } = await axios.get(EnsLeaderBoard.ENS_LEADERBOARD_API, {
        params: {
          count: limit,
          skip: page * limit,
        },
      });

      page++;
      accounts.push(
        ...data.frens.map((f: any) => ({
          ens: f.ens,
          followers: f.followers,
          verified: f.verified,
          ranking: f.ranking,
        })),
      );
      Logger.debug(`Fetched ${page} page`);
      if (accounts.length >= data.count || page >= maxPage) break;
    }

    return accounts;
  }
}

class HoneyPotChecker {
  static VERY_HIGH_MULTIPLIER = 10;

  constructor(
    private leaderboard: EnsLeaderBoard,
    private honeypotSet: Set<string>,
    private highBalanceByChainId: { [network: string]: BigNumber } = {
      [Network.MAINNET]: ethers.utils.parseUnits('1.5'),
      [Network.BSC]: ethers.utils.parseUnits('6'),
      [Network.POLYGON]: ethers.utils.parseUnits('2000'),
      [Network.FANTOM]: ethers.utils.parseUnits('4600'),
      [Network.ARBITRUM]: ethers.utils.parseUnits('1.5'), // ETH
      [Network.AVALANCHE]: ethers.utils.parseUnits('118'),
      [Network.OPTIMISM]: ethers.utils.parseUnits('1.5'), // ETH
    },
    private cexNonceByChainId: { [chain: number]: number } = {
      [0]: 400_000, // default
      [Network.MAINNET]: 50_000,
    },
  ) {}

  async testAddress(
    address: string,
    provider: ethers.providers.StaticJsonRpcProvider,
    blockNumber?: number,
  ): Promise<HoneypotAnalysisResult> {
    // In the context of this bot,
    // Honeypot is an EOA or a contract address with a good reputation in the web3, e.g. vitalik.eth.

    // The determination is made by the following indicators:
    // 1. Hardcoded addresses
    // 2. High native token balance
    // 3. ENS record
    // 4. Twitter followers

    // TODO
    // 5. Check if a well-known contract
    // 6. Large or highly-priced NFT collections
    // 7. Frequently airdropped account

    const metadata = {} as HoneypotAnalysisMetadata;

    metadata['HardCodedAccount'] = { detected: this.honeypotSet.has(address) };

    if (metadata['HardCodedAccount'].detected) {
      return {
        isHoneypot: true,
        metadata: metadata,
      };
    }

    const network = provider.network;
    const balance = await retry(() => provider.getBalance(address, blockNumber));

    if (!this.highBalanceByChainId[network.chainId])
      throw new Error('Network is not supported yet: ' + network.chainId);

    metadata['HighBalance'] = {
      detected: balance.gt(this.highBalanceByChainId[network.chainId]),
      balance: ethers.utils.formatEther(balance),
    };

    metadata['VeryHighBalance'] = {
      detected: balance.gt(
        this.highBalanceByChainId[network.chainId].mul(HoneyPotChecker.VERY_HIGH_MULTIPLIER),
      ),
      balance: ethers.utils.formatEther(balance),
    };

    const nonce = await retry(() => provider.getTransactionCount(address));

    const cexNonce = this.cexNonceByChainId[network.chainId] || this.cexNonceByChainId[0];

    metadata['CEX'] = {
      detected: nonce >= cexNonce,
      nonce: nonce,
    };

    let ensProvider: ethers.providers.StaticJsonRpcProvider = provider;
    if (provider.network.chainId !== Network.MAINNET) {
      ensProvider = PUBLIC_ENS_PROVIDER;
    }

    const name = await retry(() => ensProvider.lookupAddress(address));

    metadata['EnsRegistered'] = {
      detected: !!name,
      name: name || undefined,
    };

    metadata['ManyTwitterFollowers'] = { detected: false };

    if (name) {
      const leader = await this.leaderboard.get(name);

      if (leader) {
        metadata['ManyTwitterFollowers'] = {
          detected: true,
          followers: leader.followers,
        };
      }
    }

    return {
      isHoneypot:
        metadata['CEX']?.detected ||
        metadata['HardCodedAccount'].detected ||
        metadata['VeryHighBalance']?.detected ||
        (metadata['HighBalance']?.detected && metadata['EnsRegistered']?.detected) ||
        metadata['ManyTwitterFollowers']?.detected,
      metadata: metadata,
    };
  }
}

export default HoneyPotChecker;
