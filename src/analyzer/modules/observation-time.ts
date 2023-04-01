import { AnalyzerModule, ModuleScanReturn, ScanParams } from '../types';

export const TOKEN_OBSERVATION_TIME = 4 * 31 * 24 * 60 * 60;
export const OBSERVATION_TIME_IS_OVER_MODULE_KEY = 'ObservationTimeIsOver';

export type ObservationTimeModuleMetadata = {
  startTime: number;
  endTime: number;
};

class ObservationTimeModule extends AnalyzerModule {
  static Key = OBSERVATION_TIME_IS_OVER_MODULE_KEY;

  async scan(params: ScanParams): Promise<ModuleScanReturn> {
    const { token, timestamp, context } = params;

    let detected = false;
    let metadata: ObservationTimeModuleMetadata | undefined = undefined;

    if (timestamp - token.timestamp > TOKEN_OBSERVATION_TIME) {
      detected = true;
      metadata = {
        startTime: token.timestamp,
        endTime: params.timestamp,
      };
    }

    context[OBSERVATION_TIME_IS_OVER_MODULE_KEY] = { detected, metadata };

    return { interrupt: detected };
  }
}

export default ObservationTimeModule;
