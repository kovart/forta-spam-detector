import fs from 'fs';
import { ethers } from 'ethers';
import { queue, QueueObject } from 'async';
import { TransactionEvent } from 'forta-agent';

import Memoizer from './utils/cache';
import DataStorage from './storage';
import TokenAnalyzer from './analyzer/analyzer';
import Logger from './utils/logger';
import { CreatedContract, TokenContract, TokenStandard } from './types';
import { AnalysisResult, AnalyzerTask } from './analyzer/types';
import { DB_FILE_PATH } from './contants';

export class SpamDetector {
  private tickInterval: number;
  private analyzer: TokenAnalyzer;
  private queue: QueueObject<any>;
  private storage: DataStorage;
  private memoizer: Memoizer;
  private taskByToken: Map<TokenContract, AnalyzerTask>;
  private analysisByToken: Map<TokenContract, AnalysisResult>;

  constructor(
    provider: ethers.providers.StaticJsonRpcProvider,
    analyzer: TokenAnalyzer,
    storage: DataStorage,
    memoizer: Memoizer,
    tickInterval: number,
  ) {
    this.tickInterval = tickInterval;

    this.storage = storage;
    this.memoizer = memoizer;
    this.analyzer = analyzer;

    this.queue = queue(this.handleTask.bind(this), 1);
    this.analysisByToken = new Map();
    this.taskByToken = new Map();
  }

  async initialize() {
    await this.storage.initialize();
  }

  addTokenToWatchList(type: TokenStandard, contract: CreatedContract) {
    this.storage.addToken({ type, ...contract });
  }

  handleTxEvent(txEvent: TransactionEvent) {
    return this.storage.handleTx(txEvent);
  }

  tick(timestamp: number, blockNumber: number) {
    for (const token of this.storage.getTokens()) {
      // Should be released before we start analyzing it again
      if (this.analysisByToken.has(token)) continue;

      const existingTask = this.taskByToken.get(token);
      if (existingTask) {
        if (!existingTask.calledAt || !existingTask.finishedAt) continue;
        if (existingTask.finishedAt + this.tickInterval > Math.floor(Date.now() / 1000)) continue;

        if (existingTask.finishedAt) {
          Logger.debug(`Re-analyzing token: ${token.address}`);
        }
      }

      const task = this.analyzer.createTask(token, timestamp, blockNumber);
      this.queue.push(task);
      this.taskByToken.set(token, task);
    }
  }

  // Testing-purpose function
  async wait() {
    if (this.queue.idle()) return;
    return this.queue.drain();
  }

  private async handleTask(task: AnalyzerTask, callback: (err?: any) => void) {
    try {
      const t0 = performance.now();
      const result = await task.run();
      Logger.debug(`Task completed in ${performance.now() - t0}ms`);

      // check if it is still needed
      if (!this.storage.hasToken(task.token.address)) {
        return callback();
      }

      this.analysisByToken.set(task.token, result);

      Logger.debug(
        `Analysis result (${task.token.address}):\n` +
          `${JSON.stringify(result.analysis, null, 2)}`,
      );
      callback();
    } catch (e) {
      Logger.error(
        {
          task: task.token,
          error: e,
        },
        'Task error',
      );
      callback(e);
    }
  }

  public releaseAnalyses() {
    const analyses: { token: TokenContract; result: AnalysisResult }[] = [];

    for (const [token, result] of this.analysisByToken) {
      analyses.push({ token, result });
      this.analysisByToken.delete(token);

      if (result.interpret().isFinalized) {
        this.deleteToken(token);
      }
    }

    return analyses;
  }

  deleteToken(token: TokenContract) {
    this.storage.deleteToken(token.address);
    this.memoizer.deleteScope(token.address);
    this.taskByToken.delete(token);
    this.analysisByToken.delete(token);
  }

  public logStats() {
    Logger.info(
      [
        `Tokens: ${this.storage.getTokens().length}`,
        `Finished: ${[...this.taskByToken.values()].filter((t) => t.finishedAt).length}`,
        `Queue: ${this.queue.length()}`,
        `Memory: ${Math.round(((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100)}Mb`,
        `Disk: ${Math.round(
          ((fs.statSync(DB_FILE_PATH, { throwIfNoEntry: false })?.size || 0 / 1024 / 1024) * 100) /
            100,
        )}Mb`,
      ].join(' | '),
    );
  }
}
