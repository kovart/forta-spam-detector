import axios from 'axios';
import { MockEthersProvider } from 'forta-agent-tools/lib/test';
import AxiosMockAdapter from 'axios-mock-adapter';

import { autoAddress } from './__utils__/helpers';
import PhishingMetadataModule from '../phishing-metadata';
import Memoizer from '../../../utils/cache';
import { TokenContract, TokenStandard } from '../../../types';
import { ModuleAnalysisResult } from '../../types';
import { erc1155Iface, erc20Iface, erc721Iface } from '../../../contants';
import { normalizeMetadataUri } from '../../../utils/helpers';
import DataStorage from '../../../storage';

// make tests so they don't wait and retry
jest.mock('../../../utils/helpers', () => ({
  ...jest.requireActual('../../../utils/helpers'),
  retry: (fn: Function) => fn(),
}));

describe('PhishingMetadata', () => {
  describe('ERC-20', () => {
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

  describe('NFT', () => {
    let result!: ModuleAnalysisResult<PhishingMetadataModule>;
    let tokenCount = 0;

    const mockEthersProvider = new MockEthersProvider();
    const indicator = new PhishingMetadataModule();

    const mockAxios = new AxiosMockAdapter(axios);

    async function run(standard: TokenStandard, description: string) {
      const context: { [key: string]: ModuleAnalysisResult<PhishingMetadataModule> } = {};

      const token = {
        address: autoAddress(),
        deployer: autoAddress(),
        blockNumber: 1234,
        timestamp: 3e8,
        type: standard,
      } as TokenContract;

      const blockTag = undefined;

      const mockDataStorage = {
        getErc721TransferEvents: jest.fn(),
        getErc1155TransferSingleEvents: jest.fn(),
        getErc1155TransferBatchEvents: jest.fn(),
      } as unknown as jest.Mocked<DataStorage>;

      const tokenId = `${tokenCount++}`;
      const uri = `ipfs://test-uri-${tokenId}.json`;
      const normalizedUri = normalizeMetadataUri(uri)!;

      if (standard === TokenStandard.Erc721) {
        mockDataStorage.getErc721TransferEvents.mockImplementation(async (contract) => {
          if (contract != token.address) throw new Error('Wrong contract address');
          return [{ tokenId: tokenId }] as any;
        });

        mockEthersProvider.addCallTo(token.address, blockTag!, erc721Iface, 'tokenURI', {
          inputs: [tokenId],
          outputs: [uri],
        });
      } else if (standard === TokenStandard.Erc1155) {
        mockDataStorage.getErc1155TransferSingleEvents.mockImplementation(async (contract) => {
          if (contract != token.address) throw new Error('Wrong contract address');
          return [{ tokenId: tokenId }] as any;
        });

        mockDataStorage.getErc1155TransferBatchEvents.mockImplementation(async (contract) => {
          if (contract != token.address) throw new Error('Wrong contract address');
          return [{ ids: [tokenId] }] as any;
        });

        mockEthersProvider.addCallTo(token.address, blockTag!, erc1155Iface, 'uri', {
          inputs: [tokenId],
          outputs: [uri],
        });
      }

      mockAxios.onGet(normalizedUri).reply(200, { description });

      await indicator.scan({
        token: token,
        blockNumber: 0,
        timestamp: 0,
        transformer: null as any,
        storage: mockDataStorage,
        memoizer: new Memoizer(),
        provider: mockEthersProvider as unknown as any,
        context: context,
      });

      result = context[indicator.key];
    }

    describe('ERC721', () => {
      it('should not detect description with just keywords', async () => {
        await run(
          TokenStandard.Erc721,
          'You have received some rewards. Visit my site to claim them.',
        );
        expect(result.detected).toStrictEqual(false);
      });

      it('should not detect description with just a dollar value', async () => {
        await run(TokenStandard.Erc721, 'You have received a $100 NFT');
        expect(result.detected).toStrictEqual(false);
      });

      it('should not detect description with just a link', async () => {
        await run(TokenStandard.Erc721, 'Some text. site.com');
        expect(result.detected).toStrictEqual(false);
      });

      it('should detect description with a link and keywords', async () => {
        await run(TokenStandard.Erc721, 'Some text. Visit site.com');
        expect(result.detected).toStrictEqual(true);
        await run(TokenStandard.Erc721, 'Claim rewards at site.com');
        expect(result.detected).toStrictEqual(true);
        await run(TokenStandard.Erc721, 'Claim rewards at site[.]com');
        expect(result.detected).toStrictEqual(true);
        await run(TokenStandard.Erc721, 'Free mint [this link](site.com)');
        expect(result.detected).toStrictEqual(true);
        await run(TokenStandard.Erc721, 'The NFT available at [this link](site.com)');
        expect(result.detected).toStrictEqual(true);
      });

      it('should detect description with a link and a dollar value', async () => {
        await run(TokenStandard.Erc721, 'You have received $100. Claim here: site.com');
        expect(result.detected).toStrictEqual(true);
      });
    });

    describe('ERC1155', () => {
      it('should not detect description with just keywords', async () => {
        await run(
          TokenStandard.Erc1155,
          'You have received some rewards. Visit my site to claim them.',
        );
        expect(result.detected).toStrictEqual(false);
      });

      it('should not detect description with just a dollar value', async () => {
        await run(TokenStandard.Erc1155, 'You have received a $100 NFT');
        expect(result.detected).toStrictEqual(false);
      });

      it('should not detect description with just a link', async () => {
        await run(TokenStandard.Erc1155, 'Some text. site.com');
        expect(result.detected).toStrictEqual(false);
      });

      it('should detect description with a link and keywords', async () => {
        await run(TokenStandard.Erc1155, 'Some text. Visit site.com');
        expect(result.detected).toStrictEqual(true);
        await run(TokenStandard.Erc1155, 'Claim rewards at site.com');
        expect(result.detected).toStrictEqual(true);
        await run(TokenStandard.Erc1155, 'Claim rewards at site[.]com');
        expect(result.detected).toStrictEqual(true);
        await run(TokenStandard.Erc1155, 'Free mint [this link](site.com)');
        expect(result.detected).toStrictEqual(true);
        await run(TokenStandard.Erc1155, 'The NFT available at [this link](site.com)');
        expect(result.detected).toStrictEqual(true);
      });

      it('should detect description with a link and a dollar value', async () => {
        await run(TokenStandard.Erc1155, 'You have received $100. Claim here: site.com');
        expect(result.detected).toStrictEqual(true);
      });
    });
  });
});
