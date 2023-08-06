import { ethers } from 'ethers';
import SqlDatabase from '../src/database';
import { TokenContract } from '../src/types';
import { AVERAGE_BLOCK_TIME, TEST_DB_PATH, TEST_ETHEREUM_PRC_URLS } from './constants';
import { filterGoodProviders, getTokenAnalyzer } from './utils';
import TokenAnalyzer from '../src/analyzer/analyzer';
import PhishingMetadataModule from '../src/analyzer/modules/phishing-metadata';
import { TOKEN_OBSERVATION_TIME } from '../src/analyzer/modules/observation-time';
import TooManyHoneyPotOwnersModule from '../src/analyzer/modules/honeypot-owners';
import LowActivityAfterAirdropModule from '../src/analyzer/modules/low-activity';
import SleepMintModule from '../src/analyzer/modules/sleep-mint';
import TokenImpersonationModule from '../src/analyzer/modules/token-impersonation';
import HoneyPotShareDominanceModule from '../src/analyzer/modules/honeypot-dominance';

describe('TokenAnalyzer', () => {
  jest.setTimeout(30 * 60 * 1000); // 30m

  let analyzer: TokenAnalyzer;
  let database: SqlDatabase;
  let lastBlockNumber: number;

  beforeAll(async () => {
    const providers = await filterGoodProviders(
      TEST_ETHEREUM_PRC_URLS.map((url) => new ethers.providers.JsonRpcBatchProvider(url)),
    );

    database = new SqlDatabase(TEST_DB_PATH);
    lastBlockNumber = await providers[0].getBlockNumber();
    analyzer = await getTokenAnalyzer(database, providers[0]);
  });

  async function getToken(address: string): Promise<TokenContract> {
    const tokens = await database.getTokens();

    const token = tokens.find((t) => t.address === address);

    if (!token) throw new Error(`Cannot find token: ${address}`);

    return token;
  }

  async function testToken(address: string, modules: { Key: string }[]) {
    const token = await getToken(address.toLowerCase());

    const task = analyzer.createTask(
      token,
      token.timestamp + TOKEN_OBSERVATION_TIME,
      token.blockNumber +
        Math.min(lastBlockNumber, Math.ceil(TOKEN_OBSERVATION_TIME / AVERAGE_BLOCK_TIME)),
    );

    const result = await task.run();
    const { isSpam } = result.interpret();

    expect(isSpam).toStrictEqual(true);
    for (const module of modules) {
      expect(result.analysis[module.Key]?.detected).toStrictEqual(true);
    }
  }

  describe('ERC-20', () => {
    it('LSD (LSD). HoneyPotShareDominance', async () => {
      await testToken('0x3bb7D387B91370C54C8964119140478c6A27f85e', [HoneyPotShareDominanceModule]);
    });

    it('Ask Chip (CHIP). TokenImpersonation', async () => {
      await testToken('0xc8a1ea674c63eb8062a4115422eaf9e1c85b2db0', [TokenImpersonationModule]);
    });

    it('BLUR (BLUR). LowActivity, SleepMint', async () => {
      await testToken('0x3e6749f4393cd4ab04f7c7eca3355e067b30954b', [
        LowActivityAfterAirdropModule,
        SleepMintModule,
      ]);
    });

    it('AbroShib.Org. Phishing, LowActivity', async () => {
      await testToken('0x573af4529756643e9c16caae7995a5ce4aad051d', [
        PhishingMetadataModule,
        LowActivityAfterAirdropModule,
      ]);
    });
  });

  describe('ERC-721', () => {
    it('Ghost eye Taoist (GET). HoneyPotShareDominance, TooManyHoneyPotOwners', async () => {
      await testToken('0x20ED9b41314a7e838685955baee89A3e15393A58', [TooManyHoneyPotOwnersModule]);
    });

    it('Mutant Hounds by Novel Labs (GM). LowActivity', async () => {
      await testToken('0xb3ce95fd7d76ce2575f31bfc25f12c25523bf5db', [
        LowActivityAfterAirdropModule,
      ]);
    });
  });

  describe('ERC-1155', () => {
    it('Unisocks.org Genesis Vault. SleepMint, Phishing, LowActivity', async () => {
      await testToken('0x01362ee055877dfba44a217e874c359a8e6e846d', [
        SleepMintModule,
        PhishingMetadataModule,
        LowActivityAfterAirdropModule,
      ]);
    });

    it('WETH Powered By Nooxbadge.com. SleepMint, Phishing, LowActivity', async () => {
      await testToken('0x0e173dd4c6e8cc0b929b540f6aa7c2a35c202554', [
        SleepMintModule,
        PhishingMetadataModule,
        LowActivityAfterAirdropModule,
      ]);
    });
  });
});
