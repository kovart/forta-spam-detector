import { ethers } from 'ethers';
import { isEqual, maxBy } from 'lodash';

import DataStorage from '../storage';
import DataTransformer from './transformer';
import HoneyPotChecker from '../utils/honeypot';
import Memoizer from '../utils/cache';
import TokenProvider from '../utils/tokens';
import Logger from '../utils/logger';
import { AnalysisContext, AnalyzerModule, AnalyzerTask } from './types';
import { TokenContract } from '../types';

import HighActivityModule, { HighActivityModuleShortMetadata } from './modules/high-activity';
import AirdropModule, { AirdropModuleShortMetadata } from './modules/airdrop';
import Erc721MultipleOwnersModule from './modules/multiple-owners';
import MultipleOwnersModule from './modules/multiple-owners';
import Erc721NonUniqueTokensModule from './modules/non-unique-tokens';
import NonUniqueTokens from './modules/non-unique-tokens';
import Erc721FalseTotalSupplyModule from './modules/total-supply';
import TooManyCreationsModule from './modules/many-creations';
import TooManyHoneyPotOwnersModule from './modules/honeypot-owners';
import PhishingMetadataModule, { PhishingModuleMetadata } from './modules/phishing-metadata';
import SilentMintModule from './modules/silent-mint';
import HoneypotsDominanceModule from './modules/honeypot-dominance';
import TokenImpersonationModule from './modules/token-impersonation';
import LowActivityAfterAirdropModule from './modules/low-activity';
import ObservationTimeModule from './modules/observation-time';
import TooMuchAirdropActivityModule from './modules/airdrop-activity';
import SleepMintModule from './modules/sleep-mint';
import TokenImpersonation from './modules/token-impersonation';
import PhishingMetadata from './modules/phishing-metadata';
import SilentMint from './modules/silent-mint';
import { parseLocation } from '../utils/helpers';

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
      new TokenImpersonationModule(tokenProvider),
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
      new HighActivityModule(),
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
    let isPhishing = analysis[PhishingMetadata.Key]?.detected || false;
    let confidence = this.calcConfidence(analysis);

    // The evaluation does not use SilentMint module because of FPs,
    // but it is displayed in the presence of other indicators
    if (
      analysis[PhishingMetadataModule.Key]?.detected ||
      analysis[TokenImpersonation.Key]?.detected ||
      (analysis[AirdropModule.Key]?.detected &&
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
          LowActivityAfterAirdropModule,
        ].find((Module) => analysis[Module.Key]?.detected))
    ) {
      isSpam = true;
    }

    if (
      [
        ObservationTimeModule,
        HighActivityModule,
        PhishingMetadataModule,
        TooMuchAirdropActivityModule,
      ].find((Module) => analysis[Module.Key]?.detected)
    ) {
      isFinalized = true;

      if (analysis[HighActivityModule.Key].detected) {
        isSpam = false;
      }
    }

    return {
      isSpam,
      isFinalized,
      isPhishing,
      confidence,
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
      isUpdated:
        currInterpretation.confidence != prevInterpretation.confidence ||
        !isEqual(currResults, prevResults),
      isChanged: currInterpretation.isSpam != prevInterpretation.isSpam,
    };
  }

  private calcConfidence(analysis: AnalysisContext): number {
    const indicators = this.getIndicators(analysis).filter(
      (m) => m !== SilentMint.Key && m !== AirdropModule.Key,
    );

    let confidence = indicators.find((i) => i === TokenImpersonationModule.Key) ? 0.75 : 0.6;

    if (indicators.length > 2) {
      confidence += 0.35;
    } else if (indicators.length > 1) {
      confidence += 0.15;
    }

    const receivers =
      (analysis[AirdropModule.Key]?.metadata as AirdropModuleShortMetadata)?.receiverCount ?? 0;

    if (receivers >= 1000) {
      confidence *= 1.2;
    } else if (receivers >= 100) {
      confidence *= 1.1;
    }

    const phishingMetadata = analysis[PhishingMetadataModule.Key]?.metadata as
      | PhishingModuleMetadata
      | undefined;

    const description: string =
      maxBy(Object.values(phishingMetadata?.descriptionByTokenId || {}), (e) => e.length) || '';

    // Too much for phishing?
    if (description.length >= 2000) {
      confidence *= 0.8;
    }

    const urls = phishingMetadata?.urls || [];
    if (urls.length > 1) {
      // Get unique hostnames
      const hosts = new Set(urls.map((url) => parseLocation(url)?.host).filter((v) => v));

      // The more unique domains there are, the less likely it is to be phishing
      const multiplier = Math.max(0.15, 0.8 / (hosts.size - 1));

      confidence *= multiplier;
    }

    const senders: number =
      (analysis[HighActivityModule.Key]?.metadata as HighActivityModuleShortMetadata)
        ?.senderCount || 0;

    if (senders >= 300) {
      confidence *= 0.8;
    }

    return Math.min(1, confidence);
  }

  private getIndicators(analysis: AnalysisContext) {
    return Object.entries(analysis)
      .filter((e) => e[1].detected && e[0] !== ObservationTimeModule.Key)
      .map((e) => e[0]);
  }
}

export default TokenAnalyzer;
