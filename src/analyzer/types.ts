import { ethers } from 'ethers';

import Memoizer from '../utils/cache';
import DataStorage from '../storage';
import DataTransformer from './transformer';
import { TokenContract } from '../types';

export type ModuleAnalysisResult = {
  detected: boolean;
  metadata?: object;
};

export type AnalysisContext = {
  [moduleKey: string]: ModuleAnalysisResult;
};

export type ScanParams = {
  token: TokenContract;
  timestamp: number;
  blockNumber: number;
  context: AnalysisContext;
  memoizer: Memoizer;
  provider: ethers.providers.StaticJsonRpcProvider;
  storage: DataStorage;
  transformer: DataTransformer;
};

// TODO Add `finalized` property to modules
export type ModuleScanReturn = { interrupt?: boolean; finalized?: boolean } | undefined | void;

export type AnalysisResult = {
  analysis: AnalysisContext;
  interpret: () => { isSpam: boolean; isFinalized: boolean };
  compare: (prevAnalysis?: AnalysisContext) => { isUpdated: boolean; isChanged: boolean };
};

export interface AnalyzerTask {
  token: TokenContract;
  timestamp: number;
  blockNumber: number;
  calledAt: number | null;
  finishedAt: number | null;
  run: () => Promise<AnalysisResult>;
}

export abstract class AnalyzerModule {
  static Key: string;

  constructor() {}

  abstract scan(params: ScanParams): Promise<ModuleScanReturn>;

  simplifyMetadata(metadata: object) {
    return metadata;
  }

  get key() {
    return (this.constructor as typeof AnalyzerModule).Key;
  }
}
