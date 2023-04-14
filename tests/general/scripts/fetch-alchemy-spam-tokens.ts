import { Network } from 'forta-agent';
import https from 'node:https';

import { getAlchemySpamTokenStorage } from '../utils/storages';

// https://docs.alchemy.com/reference/getspamcontracts
const CHAINS = {
  [Network.MAINNET]: 'eth-mainnet',
  [Network.POLYGON]: 'polygon-mainnet',
};

async function main() {
  for (const [chainId, chainKey] of Object.entries(CHAINS)) {
    const url = `https://${chainKey}.g.alchemy.com/nft/v2/docs-demo/getSpamContracts`;

    console.log(`Fetching spam contract for network ID ${chainId}: ${url}`);

    const opts = {
      headers: { origin: 'https://docs.alchemy.com/', accept: 'application/json' },
    };

    const addresses = (await new Promise((res, rej) => {
      https
        .get(url, opts, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (body += chunk));
          response.on('end', () => res(JSON.parse(body)));
        })
        .on('error', rej);
    })) as string[];

    const storage = getAlchemySpamTokenStorage(Number(chainId));

    await storage.write(addresses.map((address) => ({ contract: address })));
  }

  console.log('Done');
}

main().catch((e) => {
  console.error(e);
  return 1;
});
