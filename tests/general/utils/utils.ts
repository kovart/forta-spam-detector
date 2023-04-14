import { providers } from 'ethers';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';

dayjs.extend(duration);

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function formatDuration(time: number): string {
  return dayjs.duration(time, 's').format('DD[d] HH[h]:mm[m]');
}

export async function isContract(
  address: string,
  provider: providers.JsonRpcProvider,
): Promise<boolean> {
  return (await provider.getCode(address)) !== '0x';
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts: {
    wait?: number;
    attempts?: number;
    formatError?: (e: any) => string;
  } = {},
): Promise<T> {
  const { attempts = 5, wait = 15 * 1000 } = opts;
  const formatError =
    opts.formatError || ((e: any) => e?.message || e?.details || e?.code || String(e));

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error(`Attempt (${attempt}/${attempts}):`, formatError(e), e);
      if (attempt >= attempts) {
        return e;
      }
      attempt++;
      await delay(wait);
    }
  }
}
