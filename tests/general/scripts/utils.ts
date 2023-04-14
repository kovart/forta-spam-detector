import dayjs from 'dayjs';

import { TokenRecord } from '../utils/storages';
import { EVENTS_INTERVAL } from './contants';

export const getEventsFilterString = (token: TokenRecord | TokenRecord[]) => {
  const tokens = Array.isArray(token) ? token : [token];

  if (tokens.length === 0) {
    // always false
    return `1 = 2`;
  }

  return tokens
    .map(
      (t) =>
        `(evt."contract_address" = ${t.contract} ` +
        `AND evt."evt_block_time" < ` +
        `timestamp '${dayjs.unix(t.timestamp).add(EVENTS_INTERVAL).format('YYYY-MM-DD HH:mm')}')`,
    )
    .join(' OR ');
};
