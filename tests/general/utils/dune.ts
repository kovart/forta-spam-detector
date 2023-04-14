import { Dune } from 'dune-ts';
import { ParameterDatas } from 'dune-ts/dist/esm/types/Parameters';
import { DUNE_USERS } from '../scripts/contants';

export function getDune(userCredentials: [string, string]) {
  const [username, password] = userCredentials;

  return new Dune({ username, password });
}

// re-initializing dune instance helps to avoid "cannot read undefined" error
export async function queryDune<T>(queryId: number, params: ParameterDatas): Promise<T[]> {
  const dune = await getDune(DUNE_USERS[0]);
  const { data } = await dune.query(queryId, params);
  return data;
}
