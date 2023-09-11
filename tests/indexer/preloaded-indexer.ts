import { erc1155Iface, erc20Iface, erc721Iface, retry, TokenStandard } from 'forta-helpers';
import { BigNumber as EtherBigNumber } from '@ethersproject/bignumber/lib/bignumber';
import { chunk, random, shuffle } from 'lodash';
import { ethers } from 'ethers';
import { IBlockchainIndexer, IndexerEvent, IndexerInterval } from './indexer';
import {
  Erc1155ApprovalForAllEvent,
  Erc1155TransferBatchEvent,
  Erc1155TransferSingleEvent,
  Erc20ApprovalEvent,
  Erc20TransferEvent,
  Erc721ApprovalEvent,
  Erc721ApprovalForAllEvent,
  Erc721TransferEvent,
  SimplifiedTransaction,
  TokenContract,
} from '../../src/types';
import { Logger } from '../utils';

export type PreloadRow = {
  contract: string;
  deployer: string;
  type: TokenStandard;
  blockNumber: number;
  timestamp: number;

  hashes: string[];
  blockNumbers: number[];
};

export type HybridIndexerPerformanceConfig = {
  concurrency: number;
  logsConcurrency: number;
};

export class PreloadedIndexer implements IBlockchainIndexer {
  private tokenInfoByAddress: Map<string, PreloadRow>;
  private providers: ethers.providers.JsonRpcBatchProvider[];
  private alternativeProviders: ethers.providers.JsonRpcBatchProvider[];
  private performanceConfig: HybridIndexerPerformanceConfig;

  private logsCache = new Map<number, Map<string, Set<ethers.providers.Log>>>();

  constructor(
    preloadedRows: PreloadRow[],
    providers: ethers.providers.JsonRpcBatchProvider[],
    alternativeProviders: ethers.providers.JsonRpcBatchProvider[],
    config: HybridIndexerPerformanceConfig,
  ) {
    this.tokenInfoByAddress = new Map(
      preloadedRows.map((r) => [
        r.contract.toLowerCase(),
        { ...r, contract: r.contract.toLowerCase() },
      ]),
    );
    this.providers = providers;
    this.alternativeProviders = alternativeProviders;
    this.performanceConfig = config;
  }

  private getTokenContract(type: TokenStandard, interval: IndexerInterval): TokenContract[] {
    const arr: TokenContract[] = [];
    for (const contract of this.tokenInfoByAddress.values()) {
      const timestamp = contract.timestamp;

      if (
        Number(contract.type) != type ||
        (interval.startDate && timestamp < interval.startDate) ||
        (interval.endDate && timestamp > interval.endDate)
      ) {
        continue;
      }

      arr.push({
        type: Number(contract.type),
        address: contract.contract,
        blockNumber: contract.blockNumber,
        timestamp: timestamp,
        deployer: contract.deployer,
      });
    }

    return arr;
  }

  async getErc20Contracts(interval: IndexerInterval): Promise<TokenContract[]> {
    return this.getTokenContract(TokenStandard.Erc20, interval);
  }

  async getErc721Contracts(interval: IndexerInterval): Promise<TokenContract[]> {
    return this.getTokenContract(TokenStandard.Erc721, interval);
  }

  async getErc1155Contracts(interval: IndexerInterval): Promise<TokenContract[]> {
    return this.getTokenContract(TokenStandard.Erc1155, interval);
  }

  async getTransactionsByContract(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<SimplifiedTransaction[]> {
    const contract = this.tokenInfoByAddress.get(params.contract);

    if (!contract) throw new Error(`Cannot find contract: ${params.contract}`);

    const hashes = contract.hashes;

    if (hashes.length === 0) return [];

    return this.getTransactionsByHashes({ ...params, hashes }, config);
  }

  async getTransactionsByHashes(
    params: { hashes: string[] } & IndexerInterval,
    config: {
      limit: number;
    },
  ): Promise<SimplifiedTransaction[]> {
    let transactions: SimplifiedTransaction[] = [];

    if (params.hashes.length === 0) throw new Error(`No hashes provided`);

    Logger.debug(`Fetching ${params.hashes.length} transactions...`);

    const providers = shuffle(this.providers);

    const concurrency = Math.min(
      Math.ceil(params.hashes.length / this.providers.length),
      this.performanceConfig.concurrency,
    );

    const blockNumberSet = new Set<number>();
    for (const batch of chunk(params.hashes, concurrency * this.providers.length)) {
      const t0 = performance.now();

      const providersResponse = await Promise.all(
        chunk(batch, this.performanceConfig.concurrency).map(async (hashes, i) => {
          const provider = new ethers.providers.JsonRpcBatchProvider(providers[i].connection);

          return retry(() => Promise.all(hashes.map((hash) => provider.getTransaction(hash))), {
            wait: random(1, 3, true) * 1000,
          });
        }),
      );

      let rawTransactions = providersResponse.flat();

      for (let i = 0; i < rawTransactions.length; i++) {
        let tx = rawTransactions[i];

        if (!tx) {
          const hash = batch[i];
          Logger.error(`Null transaction: ${hash}`);

          for (const provider of this.alternativeProviders) {
            const rawTransaction = await provider.getTransaction(hash);

            if (rawTransaction) {
              tx = rawTransaction;
              break;
            }
          }

          if (!tx) throw new Error(`Cannot fetch transaction: ${hash}`);

          rawTransactions[i] = tx;
        }
      }

      for (const tx of rawTransactions) {
        blockNumberSet.add(tx.blockNumber!);
      }

      for (let i = 0; i < rawTransactions.length; i++) {
        const tx = rawTransactions[i];
        const transactionIndex = (tx as any).transactionIndex as number;

        transactions.push({
          hash: tx.hash,
          from: tx.from.toLowerCase(),
          to: tx.to ? tx.to.toLowerCase() : null,
          index: transactionIndex,
          timestamp: tx.timestamp ?? 0,
          blockNumber: tx.blockNumber ?? 0,
          sighash: tx.data.slice(0, 10),
        });
      }

      Logger.debug(
        `Successfully fetched ${batch.length} transactions (${transactions.length}/${
          params.hashes.length
        }) in ${performance.now() - t0}ms`,
      );
    }

    Logger.debug('Fetching transaction timestamps...');

    let blockCounter = 0;
    const timestampByBlockNumber = new Map<number, number>();
    for (const batch of chunk([...blockNumberSet], concurrency * this.providers.length)) {
      const t0 = performance.now();

      const providersResponse = await Promise.all(
        chunk(batch, this.performanceConfig.concurrency).map((blockNumbers, i) => {
          const provider = new ethers.providers.JsonRpcBatchProvider(providers[i].connection);

          return retry(
            () => Promise.all(blockNumbers.map((blockNumber) => provider.getBlock(blockNumber))),
            { wait: random(1, 1.25, true) },
          );
        }),
      );

      const blocks = providersResponse.flat();

      blockCounter += blocks.length;

      for (const block of blocks) {
        timestampByBlockNumber.set(block.number, block.timestamp);
      }

      Logger.debug(
        `Successfully fetched ${batch.length} blocks (${blockCounter}/${blockNumberSet.size}) in ${
          performance.now() - t0
        }ms`,
      );
    }

    Logger.debug('Assigning timestamps...');
    for (const tx of transactions) {
      tx.timestamp = timestampByBlockNumber.get(tx.blockNumber)!;
    }

    transactions = transactions.filter((t) => !params.endDate || t.timestamp <= params.endDate);

    return transactions;
  }

  async getErc20ApprovalEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc20ApprovalEvent>[]> {
    return this.getEvents<Erc20ApprovalEvent>({
      ...params,
      topic: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
      parseLog: (log) => erc20Iface.parseLog(log),
      getArgs: (log) => ({
        spender: log.args['spender'].toLowerCase(),
        owner: log.args['owner'].toLowerCase(),
        value: BigInt(log.args['value'].toString()),
      }),
    });
  }

  async getErc20TransferEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc20TransferEvent>[]> {
    return this.getEvents<Erc20TransferEvent>({
      ...params,
      topic: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      parseLog: (log) => erc20Iface.parseLog(log),
      getArgs: (log) => ({
        from: log.args['from'].toLowerCase(),
        to: log.args['to'].toLowerCase(),
        value: BigInt(log.args['value'].toString()),
      }),
    });
  }

  getErc721ApprovalEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc721ApprovalEvent>[]> {
    return this.getEvents<Erc721ApprovalEvent>({
      ...params,
      topic: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
      parseLog: (log) => erc721Iface.parseLog(log),
      getArgs: (log) => ({
        owner: log.args['owner'].toLowerCase(),
        approved: log.args['approved'].toLowerCase(),
        tokenId: log.args['tokenId'].toString(),
      }),
    });
  }

  getErc721TransferEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc721TransferEvent>[]> {
    return this.getEvents<Erc721TransferEvent>({
      ...params,
      topic: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      parseLog: (log) => erc721Iface.parseLog(log),
      getArgs: (log) => ({
        from: log.args['from'].toLowerCase(),
        to: log.args['to'].toLowerCase(),
        tokenId: log.args['tokenId'].toString(),
      }),
    });
  }

  getErc721ApprovalForAllEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc721ApprovalForAllEvent>[]> {
    return this.getEvents<Erc721ApprovalForAllEvent>({
      ...params,
      topic: '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
      parseLog: (log) => erc721Iface.parseLog(log),
      getArgs: (log) => ({
        owner: log.args['owner'].toLowerCase(),
        operator: log.args['operator'].toLowerCase(),
        approved: log.args['approved'],
      }),
    });
  }

  getErc1155TransferSingleEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc1155TransferSingleEvent>[]> {
    return this.getEvents<Erc1155TransferSingleEvent>({
      ...params,
      topic: '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
      parseLog: (log) => erc1155Iface.parseLog(log),
      getArgs: (log) => {
        return {
          from: log.args['from'].toLowerCase(),
          to: log.args['to'].toLowerCase(),
          operator: log.args['operator'].toLowerCase(),
          tokenId: log.args['id'].toString(),
          value: BigInt(log.args['value'].toString()),
        };
      },
    });
  }

  getErc1155TransferBatchEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc1155TransferBatchEvent>[]> {
    return this.getEvents<Erc1155TransferBatchEvent>({
      ...params,
      topic: '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
      parseLog: (log) => erc1155Iface.parseLog(log),
      getArgs: (log) => ({
        from: log.args['from'].toLowerCase(),
        to: log.args['to'].toLowerCase(),
        operator: log.args['operator'].toLowerCase(),
        ids: log.args['ids'].map((id: EtherBigNumber) => id.toString()),
        values: log.args[4].map((v: EtherBigNumber) => BigInt(v.toString())),
      }),
    });
  }

  getErc1155ApprovalForAllEvents(
    params: { contract: string } & IndexerInterval,
    config: { limit: number },
  ): Promise<IndexerEvent<Erc1155ApprovalForAllEvent>[]> {
    return this.getEvents<Erc1155ApprovalForAllEvent>({
      ...params,
      topic: '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
      parseLog: (log) => erc1155Iface.parseLog(log),
      getArgs: (log) => {
        return {
          owner: log.args['account'].toLowerCase(),
          operator: log.args['operator'].toLowerCase(),
          approved: log.args['approved'],
        };
      },
    });
  }

  private async getEvents<T>(
    params: {
      contract: string;
      topic: string;
      parseLog: (log: ethers.providers.Log) => ethers.utils.LogDescription;
      getArgs: (log: ethers.utils.LogDescription) => T;
    } & IndexerInterval,
  ) {
    const tokenInfo = this.tokenInfoByAddress.get(params.contract);

    if (!tokenInfo) throw new Error('Cannot find contract');

    const t0 = performance.now();

    const arr: IndexerEvent<T>[] = [];

    Logger.debug(`Fetching logs from ${tokenInfo.blockNumbers.length} blocks`);

    const logs = await this.fetchLogs({
      blockNumbers: [...new Set([tokenInfo.blockNumber, ...tokenInfo.blockNumbers])],
      contract: params.contract,
      topic: params.topic,
    });

    for (const log of logs) {
      try {
        const parsedLog = params.parseLog(log);
        arr.push({
          contract: log.address.toLowerCase(),
          logIndex: log.logIndex,
          transactionHash: log.transactionHash,
          ...params.getArgs(parsedLog),
        });
      } catch (e) {
        // ignore
        Logger.error(e, 'Error while parsing log');
      }
    }

    Logger.debug(
      `Successfully fetched and parsed ${arr.length} logs in ${performance.now() - t0}ms`,
    );

    return arr;
  }

  private async fetchLogs(params: {
    blockNumbers: number[];
    contract: string;
    topic: string;
  }): Promise<Set<ethers.providers.Log>> {
    const logs: Set<ethers.providers.Log> = new Set();
    const missingBlockNumbers: number[] = [];

    for (const blockNumber of params.blockNumbers) {
      const cachedLogSet = this.logsCache.get(blockNumber)?.get(params.contract) || new Set();

      if (cachedLogSet.size > 0) {
        for (const log of cachedLogSet) {
          if (log.topics[0] === params.topic) {
            logs.add(log);
          }
        }
      } else {
        missingBlockNumbers.push(blockNumber);
      }
    }

    missingBlockNumbers.sort();

    const providers = shuffle(this.providers);

    const concurrency = Math.min(
      Math.ceil(params.blockNumbers.length / providers.length),
      this.performanceConfig.logsConcurrency,
    );

    for (const largeBatch of chunk(missingBlockNumbers, concurrency * providers.length)) {
      const providerBatches = chunk(largeBatch, concurrency);

      const result = await Promise.all(
        providerBatches.map(async (batch, i) => {
          // re-initialize provider to avoid "no-network" error
          const provider = new ethers.providers.JsonRpcBatchProvider(providers[i].connection);

          const logs = await Promise.all(
            batch.map((blockNumber) => {
              return retry(
                () =>
                  provider.getLogs({
                    address: params.contract,
                    fromBlock: blockNumber,
                    toBlock: blockNumber,
                  }),
                { wait: random(1, 3, true) * 1000 },
              );
            }),
          );

          return logs.flat();
        }),
      );

      const resultLogs = result.flat(2);

      // Cache logs
      for (const log of resultLogs) {
        let blockLogsMap = this.logsCache.get(log.blockNumber);
        if (!blockLogsMap) {
          blockLogsMap = new Map();
          this.logsCache.set(log.blockNumber, blockLogsMap);
        }

        let logSet = blockLogsMap.get(params.contract);
        if (!logSet) {
          logSet = new Set();
          blockLogsMap.set(params.contract, logSet);
        }

        logSet.add(log);
      }

      const targetLogs = resultLogs.filter((l) => l.topics[0] === params.topic);
      for (const log of targetLogs) {
        logs.add(log);
      }

      Logger.info(`Successfully fetched: ${targetLogs.length} logs`);
    }

    return logs;
  }

  public clearCache() {
    this.logsCache = new Map();
  }
}
