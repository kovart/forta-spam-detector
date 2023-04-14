import { chunk, shuffle } from 'lodash';
import { Network } from 'forta-agent';

import { queryDune } from '../utils/dune';
import { PATH_CONFIGS, TARGET_NETWORKS } from './contants';
import {
  getAlchemySpamTokenStorage,
  getCoingeckoGoodTokenStorage,
  getDappRadarSpamTokenStorage,
  getTokenStorage,
  TokenRecord,
} from '../utils/storages';
import { TokenStandard } from '../../../src/types';
import { getEventsFilterString } from './utils';
import { JsonStorage } from '../../../src/utils/storage';
import { DUNE_NETWORK_BY_NETWORK } from '../../constants';

// https://dune.com/queries/2211595
const CONTRACTS_QUERY_ID = 2211595;
// https://dune.com/queries/2227600
const AIRDROP_QUERY_ID = 2227600;

type DuneContractDataRow = {
  contract: string;
  deployer: string;
  block_number: number;
  timestamp: string;
  type: 'ERC20' | 'ERC721' | 'ERC1155' | 'Unknown';
};

type DuneAirdropDataRow = {
  contract_address: string;
};

type ProgressState = {
  [network: number]: {
    goodTokens: boolean;
    goodTokensAirdrop: boolean;
    spamTokens: boolean;
  };
};

const progressStorage = new JsonStorage<ProgressState>(
  PATH_CONFIGS.DATA_DIRECTORY,
  'tokens.progress.json',
);

function createTokenRecord(
  row: DuneContractDataRow,
  isSpam: boolean,
  isAirdrop: boolean,
): TokenRecord {
  return {
    contract: row.contract,
    deployer: row.deployer,
    blockNumber: row.block_number,
    timestamp: Math.floor(new Date(row.timestamp).valueOf() / 1000),
    type: row.type === 'Unknown' ? 'Unknown' : Number(row.type.toLowerCase().replace('erc', '')),
    spam: isSpam,
    airdrop: isAirdrop,
  };
}

async function fetchContractData(
  network: Network,
  tokens: { contract: string }[],
  log: (msg: string) => void,
) {
  const contractAddresses = tokens.map((t) => t.contract.toLowerCase());
  const contractSet = new Set(contractAddresses);

  log(`Fetching contracts deployment data (${contractSet.size} tokens)...`);
  log(`Duplicated records: ${contractAddresses.length - contractSet.size}`);

  return (
    await queryDune<DuneContractDataRow>(CONTRACTS_QUERY_ID, [
      { key: 'network', value: DUNE_NETWORK_BY_NETWORK[network], type: 'text' },
      {
        key: 'contracts',
        value: [...contractSet].join(','),
        type: 'text',
      },
    ])
  )
    .filter((v) => v.type !== 'Unknown')
    .map((v) => createTokenRecord(v, false, false));
}

async function main() {
  const progressState = (await progressStorage.read()) || {};

  console.log('Progress', progressState);

  for (const network of TARGET_NETWORKS) {
    const log = (msg: string) => console.log(`${Network[network]} | ${msg}`);
    const progress = progressState[network] || {
      goodTokensAirdrop: false,
      spamTokens: false,
      goodTokens: false,
    };

    const tokensStorage = getTokenStorage(network);
    const tokens: TokenRecord[] = (await tokensStorage.read()) || [];

    if (!progress.goodTokens) {
      const coinGeckoTokens = await getCoingeckoGoodTokenStorage(network).read();
      const goodTokens = await fetchContractData(network, coinGeckoTokens, log);
      tokens.push(...goodTokens);

      await tokensStorage.write(tokens);
      await progressStorage.write({
        ...progressState,
        [network]: {
          ...progress,
          goodTokens: true,
        },
      });
    }

    if (!progress.goodTokensAirdrop) {
      const airdropSet = new Set<string>();
      const chunks = chunk(shuffle(tokens), 2000);
      for (let i = 0; i < chunks.length; i++) {
        log(`Fetching airdrop data ${i}/${chunks.length}...`);

        const chunk = chunks[i];
        const erc20Tokens = chunk.filter((t) => t.type === TokenStandard.Erc20);
        const erc721Tokens = chunk.filter((t) => t.type === TokenStandard.Erc721);
        const erc1155Tokens = chunk.filter((t) => t.type === TokenStandard.Erc1155);

        const airdrops = await queryDune<DuneAirdropDataRow>(AIRDROP_QUERY_ID, [
          {
            key: 'erc20WhereFilter',
            value: getEventsFilterString(erc20Tokens),
            type: 'text',
          },
          {
            key: 'erc721WhereFilter',
            value: getEventsFilterString(erc721Tokens),
            type: 'text',
          },
          {
            key: 'erc1155WhereFilter',
            value: getEventsFilterString(erc1155Tokens),
            type: 'text',
          },
          { key: 'min_recipients', value: '10', type: 'number' },
          { key: 'network', value: DUNE_NETWORK_BY_NETWORK[network], type: 'text' },
        ]);
        airdrops.forEach((a) => airdropSet.add(a.contract_address));
      }

      tokens.forEach((t) => (t.airdrop = airdropSet.has(t.contract)));

      await tokensStorage.write(tokens);
      await progressStorage.write({
        ...progressState,
        [network]: {
          ...progress,
          goodTokensAirdrop: true,
        },
      });
    }

    if (!progress.spamTokens) {
      const alchemyTokens = await getAlchemySpamTokenStorage(network).read();
      const dappradarTokens = await getDappRadarSpamTokenStorage(network).read();

      const alchemySpamTokens = await fetchContractData(network, alchemyTokens, log);
      const dappradarSpamTokens = await fetchContractData(network, dappradarTokens, log);

      alchemySpamTokens.forEach((t) => (t.spam = true));
      dappradarSpamTokens.forEach((t) => (t.spam = true));

      tokens.push(...alchemySpamTokens);
      tokens.push(...dappradarSpamTokens);

      log(`Saving the result...`);

      await tokensStorage.write(tokens);
      await progressStorage.write({
        ...progressState,
        [network]: { ...progress, spamTokens: true },
      });
    }
  }
}

main().catch((e) => {
  console.error(e);
  return 1;
});
