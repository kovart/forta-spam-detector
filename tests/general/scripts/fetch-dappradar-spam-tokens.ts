import axios from 'axios';
import { TARGET_NETWORKS } from './contants';
import { BaseSpamToken, getDappRadarSpamTokenStorage } from '../utils/storages';

const URL = 'https://raw.githubusercontent.com/dappradar/tokens-blacklist/main/all-tokens.json';

async function main() {
  const {
    data: { tokens: allTokens },
  } = await axios.get(URL);

  for (const network of TARGET_NETWORKS) {
    const tokens: BaseSpamToken[] = [];

    for (const token of allTokens) {
      if (Number(token.chainId) === network) {
        tokens.push({ contract: token.address });
      }
    }

    if (tokens.length > 0) {
      await getDappRadarSpamTokenStorage(network).write(tokens);
    }
  }
}

main().catch((e) => {
  console.error(e);
  return 1;
});
