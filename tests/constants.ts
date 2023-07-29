import path from 'path';
import dotenv from 'dotenv';
import { TokenStandard } from '../src/types';
import SleepMintModule from '../src/analyzer/modules/sleep-mint';
import LowActivityAfterAirdropModule from '../src/analyzer/modules/low-activity';
import TokenImpersonationModule from '../src/analyzer/modules/token-impersonation';
import HoneyPotShareDominanceModule from '../src/analyzer/modules/honeypot-dominance';
import TooManyHoneyPotOwnersModule from '../src/analyzer/modules/honeypot-owners';
import PhishingMetadataModule from '../src/analyzer/modules/phishing-metadata';
import Erc721NonUniqueTokensModule from '../src/analyzer/modules/non-unique-tokens';

dotenv.config({
  path: path.resolve(__dirname, '../.env.private'),
});

export const DATA_PATH = path.resolve(__dirname, './data/');

export const TEST_ETHEREUM_PRC_URLS: string[] = process.env.ETHEREUM_PROVIDER_RPC_URLS
  ? JSON.parse(process.env.ETHEREUM_PROVIDER_RPC_URLS)
  : [
      'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth',
      'https://1rpc.io/eth',
      'https://eth-mainnet-public.unifra.io',
      'https://ethereum.publicnode.com',
    ];

// https://ycharts.com/indicators/ethereum_average_block_time
export const AVERAGE_BLOCK_TIME = 12.06;
export const TEST_DB_PATH = path.resolve(DATA_PATH, './database.db');

export const TOKEN_ADDRESSES: string[] = [
  // ERC20
  '0x3bb7d387b91370c54c8964119140478c6a27f85e',
  '0xc8a1ea674c63eb8062a4115422eaf9e1c85b2db0',
  '0x3e6749f4393cd4ab04f7c7eca3355e067b30954b',
  '0x573af4529756643e9c16caae7995a5ce4aad051d',
  // ERC721
  '0x20ed9b41314a7e838685955baee89a3e15393a58',
  '0xb3ce95fd7d76ce2575f31bfc25f12c25523bf5db',
  // ERC1155
  '0x01362ee055877dfba44a217e874c359a8e6e846d',
  '0x0e173dd4c6e8cc0b929b540f6aa7c2a35c202554',
];
