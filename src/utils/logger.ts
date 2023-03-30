import pino from 'pino';
import path from 'path';

import { DATA_PATH } from '../contants';

const LOG_FILE_PATH = path.resolve(DATA_PATH, '../logs/agent.log');

const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    destination: LOG_FILE_PATH,
  },
});

const Logger = pino(transport);
Logger.level = 'trace';

export default Logger;
