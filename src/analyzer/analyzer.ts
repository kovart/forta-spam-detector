import { ethers } from 'ethers';
import { isEqual } from 'lodash';

import DataStorage from '../storage';
import DataTransformer from './transformer';
import HoneyPotChecker, { EnsLeaderBoard, HoneypotSet } from '../utils/honeypot';
import Memoizer from '../utils/cache';
import TokenProvider from '../utils/tokens';
import Logger from '../utils/logger';
import { JsonStorage } from '../utils/storage';
import { AnalysisContext, AnalyzerModule, AnalyzerTask } from './types';
import { DATA_PATH } from '../contants';
import { TokenContract } from '../types';

import HighActivityModule from './modules/high-activity';
import AirdropModule from './modules/airdrop';
import Erc721MultipleOwnersModule from './modules/multiple-owners';
import MultipleOwnersModule from './modules/multiple-owners';
import Erc721NonUniqueTokensModule from './modules/non-unique-tokens';
import NonUniqueTokens from './modules/non-unique-tokens';
import Erc721FalseTotalSupplyModule from './modules/total-supply';
import TooManyCreationsModule from './modules/many-creations';
import TooManyHoneyPotOwnersModule from './modules/honeypot-owners';
import PhishingMetadataModule from './modules/phishing-metadata';
import SleepMintModule from './modules/sleep-mint';
import HoneypotsDominanceModule from './modules/honeypot-dominance';
import TokenImpersonationModule from './modules/token-impersonation';
import LowActivityAfterAirdropModule from './modules/low-activity';
import ObservationTimeModule from './modules/observation-time';

class TokenAnalyzer {
  private modules: AnalyzerModule[];
  private storage: DataStorage;
  private transformer: DataTransformer;
  private provider: ethers.providers.StaticJsonRpcProvider;
  private memoizer: Memoizer;

  constructor(
    provider: ethers.providers.StaticJsonRpcProvider,
    storage: DataStorage,
    memoizer: Memoizer,
  ) {
    const leaderStorage = new JsonStorage<any>(DATA_PATH, 'leaders.json');
    const tokenStorage = new JsonStorage<any>(DATA_PATH, 'tokens.json');
    const honeyPotChecker = new HoneyPotChecker(new EnsLeaderBoard(leaderStorage), HoneypotSet);

    this.storage = storage;
    this.provider = provider;
    this.memoizer = memoizer;
    this.transformer = new DataTransformer(storage);
    this.modules = [
      new ObservationTimeModule(),
      new HighActivityModule(),
      new AirdropModule(),
      new LowActivityAfterAirdropModule(),
      new Erc721MultipleOwnersModule(),
      new Erc721NonUniqueTokensModule(),
      new Erc721FalseTotalSupplyModule(),
      new TooManyCreationsModule(),
      new PhishingMetadataModule(),
      new SleepMintModule(),
      new TooManyHoneyPotOwnersModule(honeyPotChecker),
      new HoneypotsDominanceModule(honeyPotChecker),
      new TokenImpersonationModule(new TokenProvider(tokenStorage)),
    ];
  }

  private async scan(token: TokenContract, timestamp: number, blockNumber: number) {
    Logger.debug(`Scanning token: ${token.address}`);

    const privateContext: AnalysisContext = {};
    const publicContext: AnalysisContext = {};
    for (const module of this.modules) {
      const t0 = performance.now();
      const result = await module.scan({
        token,
        timestamp,
        blockNumber,
        context: privateContext,
        memoizer: this.memoizer,
        storage: this.storage,
        transformer: this.transformer,
        provider: this.provider,
      });
      const t1 = performance.now();
      Logger.debug(`Module ${module.key} executed in ${t1 - t0}ms`);

      publicContext[module.key] = {
        detected: privateContext[module.key].detected,
        metadata: privateContext[module.key].metadata
          ? module.simplifyMetadata(privateContext[module.key].metadata!)
          : undefined,
      };

      if (result?.interrupt) break;
    }

    return publicContext;
  }

  createTask(token: TokenContract, timestamp: number, blockNumber: number): AnalyzerTask {
    const task = {
      token,
      timestamp,
      blockNumber,
      calledAt: null,
      finishedAt: null,
    } as AnalyzerTask;

    task.run = async () => {
      task.calledAt = Math.floor(Date.now() / 1000);
      const result = await this.scan(token, timestamp, blockNumber);
      task.finishedAt = Math.floor(Date.now() / 1000);
      return this.createAnalysisResult(result);
    };

    return task;
  }

  private createAnalysisResult(analysis: AnalysisContext) {
    return {
      analysis: analysis,
      interpret: () => this.interpret(analysis),
      compare: (prevAnalysis?: AnalysisContext) => this.compare(analysis, prevAnalysis),
    };
  }

  private interpret(analysis: AnalysisContext) {
    let isSpam = false;
    let isFinalized = false; // no longer need to monitor this token

    if (
      [ObservationTimeModule.Key, HighActivityModule.Key].find((key) => analysis[key]?.detected)
    ) {
      isFinalized = true;
    }

    if (
      analysis[AirdropModule.Key]?.detected &&
      [
        MultipleOwnersModule.Key,
        Erc721FalseTotalSupplyModule.Key,
        NonUniqueTokens.Key,
        TooManyCreationsModule.Key,
        TooManyHoneyPotOwnersModule.Key,
        HoneypotsDominanceModule.Key,
        SleepMintModule.Key,
        PhishingMetadataModule.Key,
        TokenImpersonationModule.Key,
        LowActivityAfterAirdropModule.Key,
      ].find((key) => analysis[key]?.detected)
    ) {
      isSpam = true;
    }

    return {
      isSpam,
      isFinalized,
    };
  }

  private compare(currAnalysis: AnalysisContext, prevAnalysis?: AnalysisContext) {
    if (!prevAnalysis) return { isUpdated: false, isChanged: false };

    const currInterpretation = this.interpret(currAnalysis);
    const prevInterpretation = this.interpret(prevAnalysis);

    const moduleKeys = [
      ObservationTimeModule.Key,
      HighActivityModule.Key,
      AirdropModule.Key,
      MultipleOwnersModule.Key,
      Erc721FalseTotalSupplyModule.Key,
      NonUniqueTokens.Key,
      TooManyCreationsModule.Key,
      TooManyHoneyPotOwnersModule.Key,
      HoneypotsDominanceModule.Key,
      SleepMintModule.Key,
      PhishingMetadataModule.Key,
      TokenImpersonationModule.Key,
      LowActivityAfterAirdropModule.Key,
    ];

    const currResults = moduleKeys.map((key) => currAnalysis[key]?.detected);
    const prevResults = moduleKeys.map((key) => prevAnalysis[key]?.detected);

    return {
      isUpdated: !isEqual(currResults, prevResults),
      isChanged: currInterpretation.isSpam != prevInterpretation.isSpam,
    };
  }
}

export default TokenAnalyzer;
