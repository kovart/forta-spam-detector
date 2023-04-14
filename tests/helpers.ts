import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';

dayjs.extend(duration);

export const formatDate = (timestamp: number) => dayjs.unix(timestamp).format('DD-MM-YYYY HH:mm');
export const formatDuration = (timestamp: number) =>
  dayjs.duration(timestamp, 'second').format('DD[d] HH[h]:mm[m]:ss[s]');
