import { ethers } from 'ethers';
import { queue, QueueObject } from 'async';
import { TransactionEvent } from 'forta-agent';

import Memoizer from './utils/cache';
import DataStorage from './storage';
import Logger from './utils/logger';
import TokenAnalyzer from './analyzer/analyzer';
import { CreatedContract, TokenContract, TokenStandard } from './types';
import { AnalysisResult, AnalyzerTask } from './analyzer/types';

export class SpamDetector {
  private tickInterval: number;
  private analyzer: TokenAnalyzer;
  private queue: QueueObject<any>;
  private storage: DataStorage;
  private memoizer: Memoizer;
  private taskByToken: Map<TokenContract, AnalyzerTask>;
  private analysisByToken: Map<TokenContract, AnalysisResult>;

  constructor(provider: ethers.providers.StaticJsonRpcProvider, tickInterval: number) {
    this.tickInterval = tickInterval;

    this.memoizer = new Memoizer();
    this.storage = new DataStorage();
    this.analyzer = new TokenAnalyzer(provider, this.storage, this.memoizer);
    this.queue = queue(this.handleTask.bind(this), 1);
    this.analysisByToken = new Map();
    this.taskByToken = new Map();
  }

  addTokenToWatchList(type: TokenStandard, contract: CreatedContract) {
    this.storage.tokenByAddress.set(contract.address, { type, ...contract });
  }

  handleTxEvent(txEvent: TransactionEvent) {
    this.storage.add(txEvent);
  }

  tick(timestamp: number, blockNumber: number) {
    for (const token of this.storage.tokenByAddress.values()) {
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
      const result = await task.run();

      // check if it is still needed
      if (!this.storage.tokenByAddress.has(task.token.address)) {
        return callback();
      }

      this.analysisByToken.set(task.token, result);

      Logger.debug(
        `Analysis result (${task.token.address}):\n` +
          `${JSON.stringify(result.analysis, null, 2)}`,
      );
      callback();
    } catch (e) {
      Logger.error('Task error:');
      Logger.error(e);
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
    this.storage.delete(token.address);
    this.memoizer.deleteScope(token.address);
    this.taskByToken.delete(token);
    this.analysisByToken.delete(token);
  }

  public logStats() {
    Logger.debug(
      [
        `Tokens: ${this.storage.tokenByAddress.size}`,
        `Finished: ${[...this.taskByToken.values()].filter((t) => t.finishedAt).length}`,
        `Queue: ${this.queue.running()}`,
        `Memory: ${Math.round(((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100)}Mb`,
      ].join(' | '),
    );
  }
}
