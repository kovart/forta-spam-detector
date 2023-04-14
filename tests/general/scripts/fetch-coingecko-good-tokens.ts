import axios from 'axios';

import { getCoingeckoGoodTokenStorage } from '../utils/storages';
import { delay } from '../utils/utils';
import { TARGET_NETWORKS } from './contants';
import {
  COINGECKO_PLATFORM_ID_BY_NETWORK,
  CoinGeckoCoin,
  CoinGeckoNft,
} from '../../../src/utils/tokens';

// https://www.coingecko.com/en/api/documentation
const NFTS_API_URL = 'https://api.coingecko.com/api/v3/nfts/list';
const COINS_API_URL = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';

async function main() {
  console.log('Fetching tokens...');

  for (const network of TARGET_NETWORKS) {
    const platformId = COINGECKO_PLATFORM_ID_BY_NETWORK[network];

    let page = 0;
    let perPage = 100;
    let total = Infinity;
    let nfts: CoinGeckoNft[] = [];
    while (nfts.length < total) {
      const response = await axios.get<CoinGeckoNft[]>(NFTS_API_URL, {
        params: {
          asset_platform_id: platformId,
          order: 'market_cap_usd_desc',
          per_page: perPage,
          page: page,
        },
      });

      total = Number(response.headers?.total || 0);
      nfts.push(...response.data);
      page++;

      await delay(10 * 1000);

      console.log(`${platformId} | Fetched NFTs: ${page}/${Math.ceil(total / perPage)}`);
    }

    console.log(`Successfully fetched ${nfts.length} NFTs`);

    console.log(`Fetching coins...`);
    await delay(10 * 1000);
    const { data: coins } = await axios.get<CoinGeckoCoin[]>(COINS_API_URL, {
      params: { include_platform: true },
    });

    console.log(`Successfully fetched ${coins.length} coins`);

    const storage = getCoingeckoGoodTokenStorage(Number(network));

    await storage.write(
      nfts.map((n) => ({ contract: n.contract_address, name: n.name, id: n.id, type: 'nft' })),
    );
    await storage.append(
      coins
        .filter((c) => c.platforms[platformId])
        .map((n) => ({
          contract: n.platforms[platformId]!,
          name: n.name,
          id: n.id,
          type: 'coin',
        })),
    );
    await delay(10 * 1000);
  }

  console.log(`Done`);
}

main().catch((e) => {
  console.error(e);
  return 1;
});
