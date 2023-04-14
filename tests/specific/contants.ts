import path from 'path';
import dotenv from 'dotenv';

dotenv.config({
  path: path.resolve(__dirname, '../../.env.private'),
});

export const DUNE_USERS: [string, string][] = JSON.parse(process.env.DUNE_USERS || '[]');

console.log(`Dune users: ${DUNE_USERS}`);

if (DUNE_USERS.length === 0) {
  throw new Error('No Dune users provided in the .env.private file');
}

export const QUERIES_DIRECTORY = path.resolve(__dirname, './queries');
export const CACHE_DIRECTORY = path.resolve(__dirname, './cache');
