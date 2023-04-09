import pino from 'pino';
import path from 'path';

import { DATA_PATH, IS_DEVELOPMENT, LOGTAIL_TOKEN } from '../contants';

const LOG_FILE_PATH = path.resolve(DATA_PATH, '../logs/agent.log');

function getTransport() {
  if (LOGTAIL_TOKEN && !IS_DEVELOPMENT) {
    return pino.transport({
      target: '@logtail/pino',
      options: { sourceToken: LOGTAIL_TOKEN },
    });
  } else if (IS_DEVELOPMENT) {
    return pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        destination: LOG_FILE_PATH,
      },
    });
  } else {
    return pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: false,
      },
    });
  }
}

const Logger = pino(getTransport());

export default Logger;
