import pino from 'pino';
import path from 'path';

import { DATA_PATH, IS_DEVELOPMENT } from '../contants';

const LOG_FILE_PATH = path.resolve(DATA_PATH, '../logs/agent.log');

const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: IS_DEVELOPMENT,
    destination: IS_DEVELOPMENT ? LOG_FILE_PATH : undefined,
  },
});

const Logger = pino(transport);
Logger.level = 'trace';

export default Logger;
