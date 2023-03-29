import axios from 'axios';
import { BigNumber, ethers } from 'ethers';
import { Network } from 'forta-agent';
import { Mutex } from 'async-mutex';

import { JsonStorage } from './storage';

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
  honeypot: boolean;
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
          this.updatedAt = cache.updatedAt;
          this.leaderByEns = new Map(cache.leaders.map((l) => [l.ens, l]));
        }
      }

      if (this.updatedAt + EnsLeaderBoard.UPDATE_INTERVAL < Date.now()) {
        await this.update();
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
        honeypot: true,
        metadata: metadata,
      };
    }

    const network = provider.network;
    const balance = await provider.getBalance(address, blockNumber);

    if (!HoneyPotChecker.NETWORK_HIGH_BALANCE_THRESHOLDS[network.chainId])
      throw new Error('Network is not supported yet: ' + network.chainId);

    metadata['HighBalance'] = {
      detected: false,
      balance: balance.toString(),
    };

    if (balance.gt(HoneyPotChecker.NETWORK_HIGH_BALANCE_THRESHOLDS[network.chainId])) {
      metadata['HighBalance']!.detected = true;
    }

    const name = await provider.lookupAddress(address);

    metadata['EnsRegistered'] = {
      detected: !!name,
      name: name || undefined,
    };

    if (name) {
      const leader = await this.leaderboard.get(name);

      if (leader) {
        metadata['ManyTwitterFollowers'] = {
          detected: true,
          followers: leader.followers,
        };
      } else {
        metadata['ManyTwitterFollowers'] = { detected: false };
      }
    } else {
      metadata['ManyTwitterFollowers'] = { detected: false };
    }

    return {
      honeypot:
        (metadata['HighBalance']!.detected && metadata['EnsRegistered']!.detected) ||
        metadata['ManyTwitterFollowers']!.detected,
      metadata: metadata,
    };
  }
}

export default HoneyPotChecker;
