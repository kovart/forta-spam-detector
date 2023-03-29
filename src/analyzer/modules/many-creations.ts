import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';

import { TokenContract } from '../../types';
import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

dayjs.extend(duration);

export const TOO_MANY_CREATIONS_MODULE_KEY = 'TooManyTokenCreations';
export const CREATION_WINDOW_TIME = dayjs.duration(3, 'month').asSeconds();
export const TOKEN_CREATIONS_THRESHOLD = 6;

export type TooManyCreationsMetadata = {
  startTime: number;
  endTime: number;
  createdTokens: string[];
};

class TooManyCreationsModule extends AnalyzerModule {
  static Key = TOO_MANY_CREATIONS_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, context, storage } = params;

    let detected = false;
    let metadata: TooManyCreationsMetadata | undefined = undefined;

    const tokens = [...storage.tokenByAddress.values()].filter(
      (t) => t.deployer === token.deployer,
    );

    for (let startIndex = 0; startIndex < tokens.length; startIndex++) {
      let createdTokens: TokenContract[] = [];

      for (let t = startIndex; t < tokens.length; t++) {
        const token = tokens[t];

        if (token.timestamp - tokens[startIndex].timestamp > CREATION_WINDOW_TIME) break;

        createdTokens.push(token);
      }

      if (createdTokens.length > TOKEN_CREATIONS_THRESHOLD) {
        detected = true;
        metadata = {
          startTime: createdTokens[0].timestamp,
          endTime: createdTokens[createdTokens.length - 1].timestamp,
          createdTokens: tokens.map((t) => t.address),
        };
        break;
      }
    }

    context[TOO_MANY_CREATIONS_MODULE_KEY] = { detected, metadata };
  }
}

export default TooManyCreationsModule;
