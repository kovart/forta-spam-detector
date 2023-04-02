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

export const HoneypotSet = new Set([
  // vitalik.eth
  '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  // Pranksy
  '0xD387A6E4e84a6C86bd90C158C6028A58CC8Ac459',
  // Cozomo de’ Medici
  '0xCe90a7949bb78892F159F428D0dC23a8E3584d75',
  // gmoney.eth
  '0xf0D6999725115E3EAd3D927Eb3329D63AFAEC09b',
  // Moonpay
  '0xd75233704795206de38Cc58B77a1f660B5C60896',
  // artchick.eth
  '0x0b8F4C4E7626A91460dac057eB43e0de59d5b44F',
  // pak.eth
  '0x2Ce780D7c743A57791B835a9d6F998B15BBbA5a4',
  // machibigbrother.eth
  '0x020cA66C30beC2c4Fe3861a94E4DB4A498A35872',
  // amir
  '0xAB6cA2017548A170699890214bFd66583A0C1754',
  // dingaling.eth
  '0x54BE3a794282C030b15E43aE2bB182E14c409C5e',
  // flur.eth
  '0xB32B4350C25141e779D392C1DBe857b62b60B4c9',
  // tim.eth
  '0xeEE5Eb24E7A0EA53B75a1b9aD72e7D20562f4283',
  // coco.eth
  '0x721931508DF2764fD4F70C53Da646Cb8aEd16acE',
  // coco.eth
  '0x721931508DF2764fD4F70C53Da646Cb8aEd16acE',
  // vombatus.eth
  '0x38A4D889a1979133FbC1D58F970f0953E3715c26',
  // vvd.eth
  '0x0F0eAE91990140C560D4156DB4f00c854Dc8F09E',
  // barthazian.eth
  '0x6186290B28D511bFF971631c916244A9fC539cfE',
  // fazebanks.eth
  '0x7d4823262Bd2c6e4fa78872f2587DDA2A65828Ed',
  // Steve Aoki
  '0xe4bBCbFf51e61D0D95FcC5016609aC8354B177C4',
  // jrnyclub.eth
  '0x1b523DC90A79cF5ee5d095825e586e33780f7188',
  // Gary Vaynerchuk
  '0x5ea9681C3Ab9B5739810F8b91aE65EC47de62119',
  // ʕ◕ᴥ◕ʔ.eth
  '0x63a9dbCe75413036B2B778E670aaBd4493aAF9F3',
  // redlioneye.eth
  '0x0a690B298f84D12414F5c8dB7de1EcE5a4605877',
  // farokh.eth
  '0xc5F59709974262c4AFacc5386287820bDBC7eB3A',

  // TODO append honeypot list
]);

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
  EnsRegistered?: {
    detected: boolean;
    name?: string;
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
  static NETWORK_HIGH_BALANCE_THRESHOLDS: { [network: string]: BigNumber } = {
    [Network.MAINNET]: ethers.utils.parseUnits('1.5'),
    [Network.BSC]: ethers.utils.parseUnits('6', 8),
    [Network.POLYGON]: ethers.utils.parseUnits('2000'),
    [Network.FANTOM]: ethers.utils.parseUnits('4600'),
    [Network.ARBITRUM]: ethers.utils.parseUnits('1.5'), // ETH
    [Network.AVALANCHE]: ethers.utils.parseUnits('118'),
    [Network.OPTIMISM]: ethers.utils.parseUnits('1.5'), // ETH
  };

  constructor(private leaderboard: EnsLeaderBoard, private honeypotSet: Set<string>) {}

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

    if (!HoneyPotChecker.NETWORK_HIGH_BALANCE_THRESHOLDS[network.chainId])
      throw new Error('Network is not supported yet: ' + network.chainId);

    metadata['HighBalance'] = {
      detected: false,
      balance: balance.toString(),
    };

    if (balance.gt(HoneyPotChecker.NETWORK_HIGH_BALANCE_THRESHOLDS[network.chainId])) {
      metadata['HighBalance']!.detected = true;
    }

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
        (metadata['HighBalance']!.detected && metadata['EnsRegistered']!.detected) ||
        metadata['ManyTwitterFollowers']!.detected,
      metadata: metadata,
    };
  }
}

export default HoneyPotChecker;
