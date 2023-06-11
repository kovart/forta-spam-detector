import pino from 'pino';
import path from 'path';

import { DATA_PATH, IS_DEVELOPMENT } from '../contants';

const LOG_FILE_PATH = path.resolve(DATA_PATH, '../logs/agent.log');

export function getLogger(params: { colorize: boolean; file: boolean; console: boolean }) {
  const targets: any[] = [];

  if (params.file) {
    targets.push({
      target: 'pino/file',
      options: {
        colorize: params.colorize,
        destination: LOG_FILE_PATH,
      },
      level: 'debug',
    });
  }
  if (params.console) {
    targets.push({
      target: 'pino-pretty',
      options: {
        colorize: params.colorize,
      },
      level: 'debug',
    });
  }

  return pino(
    pino.transport({
      targets: targets,
    }),
  );
}

const Logger = getLogger({
  colorize: IS_DEVELOPMENT,
  file: IS_DEVELOPMENT,
  console: !IS_DEVELOPMENT,
});

export default Logger;
