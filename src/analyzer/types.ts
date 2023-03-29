import { ethers } from 'ethers';

import Memoizer from '../utils/cache';
import DataStorage from '../storage';
import { TokenContract } from '../types';

export type ModuleAnalysisResult = {
  detected: boolean;
  metadata?: {};
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
};

export type ModuleScanReturn = { interrupt?: boolean } | undefined | void;

export type AnalysisResult = {
  analysis: AnalysisContext;
  interpret: () => { isSpam: boolean; isFinalized: boolean };
  compare: (prevAnalysis?: AnalysisContext) => { isUpdated: boolean; isChanged: boolean };
};

export interface AnalyzerTask {
  token: TokenContract;
  run: () => Promise<AnalysisResult>;
}

export abstract class AnalyzerModule {
  static Key: string;

  constructor() {}

  abstract scan(params: ScanParams): Promise<ModuleScanReturn>;

  get key() {
    return (this.constructor as typeof AnalyzerModule).Key;
  }
}
