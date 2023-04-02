import { Network } from 'forta-agent';
import { set, uniqBy } from 'lodash';
import { Dune } from 'dune-ts';

import { getTestTokenStorage, TokenRecord } from '../utils/storages';
import { DUNE_NETWORK_BY_NETWORK, DUNE_USERS, PATH_CONFIGS, TARGET_NETWORKS } from './contants';
import { TokenStandard } from '../../src/types';
import { JsonStorage } from '../../src/utils/storage';
import { getDune } from '../utils/dune';
import { getEventsFilterString } from './utils';
import { DuneEvent } from './types';
import { providersQueue, ProvidersQueueResult } from '../utils/utils';
import Database from '../utils/database';

type EventFetchProgress = {
  [tokenInterface: number]: {
    [eventName: string]: string[];
  };
};

export const getEventProgressStorage = (network: Network) =>
  new JsonStorage<EventFetchProgress>(
    PATH_CONFIGS.DATA_DIRECTORY,
    `events-${network}.progress.json`,
  );

const QUERY_MAP = {
  [TokenStandard.Erc20]: [
    { name: 'Transfer', queryId: 2228629, insert: Database.insertErc20TransferEvents },
    { name: 'Approval', queryId: 2235209, insert: Database.insertErc20ApprovalEvents },
  ],
  [TokenStandard.Erc721]: [
    { name: 'Transfer', queryId: 2235354, insert: Database.insertErc721TransferEvents },
    { name: 'Approval', queryId: 2235465, insert: Database.insertErc721ApprovalEvents },
    { name: 'ApprovalForAll', queryId: 2235509, insert: Database.insertErc721ApprovalForAllEvents },
  ],
  [TokenStandard.Erc1155]: [
    {
      name: 'TransferSingle',
      // queryId: 2235668,
      queryId: 2254708,
      insert: Database.insertErc1155TransferSingleEvents,
    },
    {
      name: 'TransferBatch',
      // queryId: 2235730,
      queryId: 2254710,
      insert: Database.insertErc1155TransferBatchEvents,
    },
    {
      name: 'ApprovalForAll',
      // queryId: 2235877,
      queryId: 2254714,
      insert: Database.insertErc1155ApprovalForAllEvents,
    },
  ],
};

const programState = {
  isTerminated: false,
};

let duneQueue: ProvidersQueueResult<TokenRecord, Dune>;

async function main() {
  Database.init();

  for (const network of TARGET_NETWORKS) {
    const progressStorage = getEventProgressStorage(network);
    const progressState: EventFetchProgress = (await progressStorage.read()) || {};

    const allTokens = uniqBy(await getTestTokenStorage(network).read(), (v) => v.contract);

    for (const entries of Object.entries(QUERY_MAP)) {
      const type = Number(entries[0]) as TokenStandard;
      const events = entries[1];
      const tokens = allTokens.filter((t) => t.type === type);

      console.log(`${Network[network]}|ERC${type} Total tokens: ${tokens.length}`);

      for (const event of events) {
        const handledTokens = progressState?.[type]?.[event.name] || [];
        const notHandledTokens = tokens.filter((t) => !handledTokens.includes(t.contract));

        const state = {
          counter: handledTokens.length,
        };

        const dunesAccounts = DUNE_USERS.map((credentials: [string, string]) => ({
          user: credentials[0],
          dune: getDune(credentials),
        }));

        duneQueue = providersQueue<TokenRecord, (typeof dunesAccounts)[number]>(
          async (token: TokenRecord, provider) => {
            if (programState.isTerminated) return;

            const log = (msg?: string) =>
              console.log(
                `[W${duneQueue.running()}]` +
                  `[${state.counter}/${tokens.length}][${provider.user.slice(-6).padEnd(6)}] ` +
                  `${Network[network]} ERC${type}-${event.name}() ${msg}`,
              );

            log(`Fetching ${token.contract.slice(0, 10)}...`);

            // login helps to avoid errors ¯\_(ツ)_/¯
            await provider.dune.login();
            const { data: rows } = await provider.dune.query(event.queryId, [
              { key: 'network', value: DUNE_NETWORK_BY_NETWORK[network], type: 'text' },
              { key: 'whereFilter', value: getEventsFilterString(token), type: 'text' },
            ]);

            log(`Fetched ${rows.length} events`);

            if (programState.isTerminated) return;

            if (rows.length > 0) {
              event.insert(
                rows.map((e: DuneEvent) => ({
                  ...e,
                  timestamp: Math.floor(new Date(e.timestamp).valueOf() / 1000),
                })) as any[],
              );

              log(`Inserted ${rows.length} events`);
            }

            handledTokens.push(token.contract);
            set(progressState, [type, event.name], handledTokens);
            await progressStorage.write(progressState);

            state.counter++;
          },
          dunesAccounts,
        );

        for (const token of notHandledTokens) {
          if (programState.isTerminated) return;
          await duneQueue.push(token);
        }

        await duneQueue.finish();
      }
    }
  }
}

function finish() {
  programState.isTerminated = true;
  duneQueue.kill();
  Database.close(() => {
    process.exit();
  });
}

main()
  .then(() => finish())
  .catch(async (e) => {
    console.error(e);
    finish();
  });

process.on('SIGINT', () => {
  console.warn('Received SIGINT');
  finish();
});
