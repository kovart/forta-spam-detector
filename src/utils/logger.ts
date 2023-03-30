import pino from 'pino';
import path from 'path';

import { DATA_PATH } from '../contants';

const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    destination: path.resolve(DATA_PATH, '../logs.log'),
  },
});

const Logger = pino(transport);
Logger.level = 'trace';

export default Logger;
