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
  private lastTickTimestamp: number;

  private analyzer: TokenAnalyzer;
  private queue: QueueObject<any>;
  private storage: DataStorage;
  private memoizer: Memoizer;
  private analysisByToken: Map<TokenContract, AnalysisResult>;

  constructor(provider: ethers.providers.StaticJsonRpcProvider, tickInterval: number) {
    this.tickInterval = tickInterval;
    this.lastTickTimestamp = -1;

    this.memoizer = new Memoizer();
    this.storage = new DataStorage();
    this.analyzer = new TokenAnalyzer(provider, this.storage, this.memoizer);
    this.queue = queue(this.handleTask.bind(this), 1);
    this.analysisByToken = new Map<TokenContract, AnalysisResult>();
  }

  addTokenToWatchList(type: TokenStandard, contract: CreatedContract) {
    this.storage.tokenByAddress.set(contract.address, { type, ...contract });
  }

  handleTxEvent(txEvent: TransactionEvent) {
    this.storage.add(txEvent);
  }

  tick(timestamp: number, blockNumber: number) {
    if (!this.queue.idle() && this.lastTickTimestamp + this.tickInterval <= timestamp) return;

    this.lastTickTimestamp = timestamp;

    for (const token of this.storage.tokenByAddress.values()) {
      this.queue.push(this.analyzer.createTask(token, timestamp, blockNumber));
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
      this.analysisByToken.set(task.token, result);
      Logger.debug(
        `Analysis result (${task.token.address}):\n` +
          `${JSON.stringify(result.analysis, null, 2)}`,
      );
      callback();
    } catch (e) {
      callback(e);
    }
  }

  public releaseAnalyses() {
    const analyses: { token: TokenContract; result: AnalysisResult }[] = [];

    for (const [token, result] of this.analysisByToken) {
      analyses.push({ token, result });

      if (result.interpret().isFinalized) {
        this.storage.delete(token.address);
      }
    }

    return analyses;
  }

  public logStats() {
    Logger.debug(
      [
        `Tokens: ${this.storage.tokenByAddress.size}`,
        `Analyses: ${this.analysisByToken.size}`,
        `Queue: ${this.queue.running()}`,
        `Memory: ${Math.round(((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100)}Mb`,
      ].join(' | '),
    );
  }
}
