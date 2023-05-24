import { ethers } from 'ethers';
import { isEqual } from 'lodash';

import DataStorage from '../storage';
import DataTransformer from './transformer';
import HoneyPotChecker from '../utils/honeypot';
import Memoizer from '../utils/cache';
import TokenProvider from '../utils/tokens';
import Logger from '../utils/logger';
import { AnalysisContext, AnalyzerModule, AnalyzerTask } from './types';
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
import SilentMintModule from './modules/silent-mint';
import HoneypotsDominanceModule from './modules/honeypot-dominance';
import TokenImpersonationModule from './modules/token-impersonation';
import LowActivityAfterAirdropModule from './modules/low-activity';
import ObservationTimeModule from './modules/observation-time';
import TooMuchAirdropActivityModule from './modules/airdrop-activity';
import SleepMintModule from './modules/sleep-mint';

class TokenAnalyzer {
  private modules: AnalyzerModule[];
  private storage: DataStorage;
  private transformer: DataTransformer;
  private provider: ethers.providers.StaticJsonRpcProvider;
  private memoizer: Memoizer;

  constructor(
    provider: ethers.providers.StaticJsonRpcProvider,
    honeyPotChecker: HoneyPotChecker,
    tokenProvider: TokenProvider,
    storage: DataStorage,
    memoizer: Memoizer,
  ) {
    this.storage = storage;
    this.provider = provider;
    this.memoizer = memoizer;
    this.transformer = new DataTransformer(storage);
    this.modules = [
      new HighActivityModule(),
      new AirdropModule(),
      new TooMuchAirdropActivityModule(),
      new LowActivityAfterAirdropModule(),
      new Erc721MultipleOwnersModule(),
      new Erc721NonUniqueTokensModule(),
      new Erc721FalseTotalSupplyModule(),
      new SilentMintModule(),
      new SleepMintModule(),
      new TooManyCreationsModule(),
      new PhishingMetadataModule(),
      new TooManyHoneyPotOwnersModule(honeyPotChecker),
      new HoneypotsDominanceModule(honeyPotChecker),
      new TokenImpersonationModule(tokenProvider),
      new ObservationTimeModule(),
    ];
  }

  private async scan(token: TokenContract, timestamp: number, blockNumber: number) {
    Logger.debug(`Scanning token: ${token.address}`);

    const scanStartTime = performance.now();

    const privateContext: AnalysisContext = {};
    const publicContext: AnalysisContext = {};
    for (const module of this.modules) {
      const moduleStartTime = performance.now();
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
      Logger.debug(`Module ${module.key} executed in ${performance.now() - moduleStartTime}ms`);

      publicContext[module.key] = {
        detected: privateContext[module.key].detected,
        metadata: privateContext[module.key].metadata
          ? module.simplifyMetadata(privateContext[module.key].metadata!)
          : undefined,
      };

      if (result?.interrupt) break;
    }

    Logger.debug(`Token ${token.address} scanned in ${performance.now() - scanStartTime}ms`);

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
      [
        ObservationTimeModule,
        HighActivityModule,
        PhishingMetadataModule,
        TooMuchAirdropActivityModule,
      ].find((Module) => analysis[Module.Key]?.detected)
    ) {
      isFinalized = true;
    }

    // The evaluation does not use SilentMint module because of FPs,
    // but it is displayed in the presence of other indicators
    if (
      analysis[AirdropModule.Key]?.detected &&
      [
        MultipleOwnersModule,
        Erc721FalseTotalSupplyModule,
        NonUniqueTokens,
        TooMuchAirdropActivityModule,
        TooManyCreationsModule,
        TooManyHoneyPotOwnersModule,
        HoneypotsDominanceModule,
        PhishingMetadataModule,
        SleepMintModule,
        TokenImpersonationModule,
        LowActivityAfterAirdropModule,
      ].find((Module) => analysis[Module.Key]?.detected)
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

    const modules = [
      ObservationTimeModule,
      HighActivityModule,
      AirdropModule,
      MultipleOwnersModule,
      Erc721FalseTotalSupplyModule,
      TooMuchAirdropActivityModule,
      SilentMintModule,
      SleepMintModule,
      NonUniqueTokens,
      TooManyCreationsModule,
      TooManyHoneyPotOwnersModule,
      HoneypotsDominanceModule,
      PhishingMetadataModule,
      TokenImpersonationModule,
      LowActivityAfterAirdropModule,
    ];

    const currResults = modules.map((Module) => currAnalysis[Module.Key]?.detected);
    const prevResults = modules.map((Module) => prevAnalysis[Module.Key]?.detected);

    return {
      isUpdated: !isEqual(currResults, prevResults),
      isChanged: currInterpretation.isSpam != prevInterpretation.isSpam,
    };
  }
}

export default TokenAnalyzer;
