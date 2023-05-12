import { MockEthersProvider } from 'forta-agent-tools/lib/test';

import { autoAddress } from './__utils__/helpers';

import PhishingMetadataModule from '../phishing-metadata';
import Memoizer from '../../../utils/cache';
import { TokenContract, TokenStandard } from '../../../types';
import { ModuleAnalysisResult } from '../../types';
import { erc20Iface } from '../../../contants';

describe('PhishingMetadata', () => {
  describe('ERC20', () => {
    let result!: ModuleAnalysisResult<PhishingMetadataModule>;

    const mockToken = {
      address: autoAddress(),
      deployer: autoAddress(),
      blockNumber: 1234,
      timestamp: 3e8,
      type: TokenStandard.Erc20,
    } as TokenContract;
    const mockEthersProvider = new MockEthersProvider();
    const indicator = new PhishingMetadataModule();

    async function run(token: [string, string]) {
      const context: { [key: string]: ModuleAnalysisResult<PhishingMetadataModule> } = {};

      const blockTag = undefined;

      mockEthersProvider.addCallTo(mockToken.address, blockTag!, erc20Iface, 'name', {
        inputs: [],
        outputs: [token[0]],
      });
      mockEthersProvider.addCallTo(mockToken.address, blockTag!, erc20Iface, 'symbol', {
        inputs: [],
        outputs: [token[1]],
      });

      await indicator.scan({
        token: mockToken,
        blockNumber: 0,
        timestamp: 0,
        transformer: null as any,
        storage: null as any,
        memoizer: new Memoizer(),
        provider: mockEthersProvider as unknown as any,
        context: context,
      });

      result = context[indicator.key];
    }

    it('should not detect phishing for "Some Token (site.cc)"', async () => {
      await run(['Some Token', 'site.cc']);
      expect(result.detected).toStrictEqual(false);
    });

    it('should not detect phishing for "site.cc (site.cc)"', async () => {
      await run(['site.cc', 'site.cc']);
      expect(result.detected).toStrictEqual(false);
    });

    it('should detect phishing for "VISIT (site.cc)"', async () => {
      await run(['VISIT', 'site.cc']);
      expect(result.detected).toStrictEqual(true);
    });

    it('should detect phishing for "site.cc (Visit this)"', async () => {
      await run(['site.cc', 'Visit this']);
      expect(result.detected).toStrictEqual(true);
    });

    it('should detect phishing for "site[.]cc (Visit this)"', async () => {
      await run(['site[.]cc', 'Visit this']);
      expect(result.detected).toStrictEqual(true);
    });

    it('should detect phishing for "site[dot]cc (Visit this)"', async () => {
      await run(['site[dot]cc', 'Visit this']);
      expect(result.detected).toStrictEqual(true);
    });

    it('should detect phishing for "Visit site.cc (TOKEN)"', async () => {
      await run(['Visit site.cc', 'TOKEN']);
      expect(result.detected).toStrictEqual(true);
    });

    it('should detect phishing for "$ site.cc (TOKEN)"', async () => {
      await run(['$ site.cc', 'TOKEN']);
      expect(result.detected).toStrictEqual(true);
    });

    it('should detect phishing for "$ 123.32 TOKEN (site.cc)"', async () => {
      await run(['$ 123.32 TOKEN', 'site.cc']);
      expect(result.detected).toStrictEqual(true);
    });

    it('should detect phishing for "$ 123.32 go site.cc (TOKEN)"', async () => {
      await run(['$ 123.32 go site.cc', 'TOKEN']);
      expect(result.detected).toStrictEqual(true);
    });
  });
});
