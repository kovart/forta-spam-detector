import axios from 'axios';
import { MockEthersProvider } from 'forta-agent-tools/lib/test';
import AxiosMockAdapter from 'axios-mock-adapter';

import { autoAddress } from './__utils__/helpers';
import PhishingMetadataModule, { PhishingModuleMetadata } from '../phishing-metadata';
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
    let result!: ModuleAnalysisResult<PhishingModuleMetadata>;

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
      const context: { [key: string]: ModuleAnalysisResult<PhishingModuleMetadata> } = {};

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
      expect(result.metadata!.urls).toHaveLength(1);
      expect(result.metadata!.urls).toContain('site.cc');
    });

    it('should detect phishing for "site.cc (Visit this)"', async () => {
      await run(['site.cc', 'Visit this']);
      expect(result.detected).toStrictEqual(true);
      expect(result.metadata!.urls).toHaveLength(1);
      expect(result.metadata!.urls).toContain('site.cc');
    });

    it('should detect phishing for "https://site.cc/test#link?query=12 (Visit this)"', async () => {
      await run(['https://site.cc/test#link?query=12', 'Visit this']);
      expect(result.detected).toStrictEqual(true);
      expect(result.metadata!.urls).toHaveLength(1);
      expect(result.metadata!.urls).toContain('site.cc/test#link?query=12');
    });

    it('should detect phishing for "site[.]cc (Visit this)"', async () => {
      await run(['site[.]cc', 'Visit this']);
      expect(result.detected).toStrictEqual(true);
      expect(result.metadata!.urls).toHaveLength(1);
      expect(result.metadata!.urls).toContain('site.cc');
    });

    it('should detect phishing for "site[dot]cc (Visit this)"', async () => {
      await run(['site[dot]cc', 'Visit this']);
      expect(result.detected).toStrictEqual(true);
      expect(result.metadata!.urls).toHaveLength(1);
      expect(result.metadata!.urls).toContain('site.cc');
    });

    it('should detect phishing for "Visit site.cc (TOKEN)"', async () => {
      await run(['Visit site.cc', 'TOKEN']);
      expect(result.detected).toStrictEqual(true);
      expect(result.metadata!.urls).toHaveLength(1);
      expect(result.metadata!.urls).toContain('site.cc');
    });

    it('should detect phishing for "Visit (t.ly/link)"', async () => {
      await run(['Visit', 't.ly/link']);
      expect(result.detected).toStrictEqual(true);
      expect(result.metadata!.urls).toHaveLength(1);
      expect(result.metadata!.urls).toContain('t.ly/link');
    });

    it('should detect phishing for "$ site.cc (TOKEN)"', async () => {
      await run(['$ site.cc', 'TOKEN']);
      expect(result.detected).toStrictEqual(true);
      expect(result.metadata!.urls).toHaveLength(1);
      expect(result.metadata!.urls).toContain('site.cc');
    });

    it('should detect phishing for "$ 123.32 TOKEN (site.cc)"', async () => {
      await run(['$ 123.32 TOKEN', 'site.cc']);
      expect(result.detected).toStrictEqual(true);
      expect(result.metadata!.urls).toHaveLength(1);
      expect(result.metadata!.urls).toContain('site.cc');
    });

    it('should detect phishing for "$ 123.32 go site.cc (TOKEN)"', async () => {
      await run(['$ 123.32 go site.cc', 'TOKEN']);
      expect(result.detected).toStrictEqual(true);
      expect(result.metadata!.urls).toHaveLength(1);
      expect(result.metadata!.urls).toContain('site.cc');
    });
  });

  describe('NFT', () => {
    let result!: ModuleAnalysisResult<PhishingModuleMetadata>;
    let tokenCount = 0;

    const mockEthersProvider = new MockEthersProvider();
    const indicator = new PhishingMetadataModule();

    const mockAxios = new AxiosMockAdapter(axios);

    async function run(standard: TokenStandard, description: string) {
      const context: { [key: string]: ModuleAnalysisResult<PhishingModuleMetadata> } = {};

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

    const longDescriptionWithLink =
      "wave flow vibrate oscillate swing waft drift float undulate surge meander...\n\n\n\nafter years of living in cities, on a trip through the alps, i’ve been immersed in a beautiful landscape. i was shocked by this vastness, depth, rhythmic beauty...\nsoft rolling hills that gently swing into each other, to the depths of overlying rugged ridges, followed by billowing cloud banks, this kind of loving frequency!\nwas it then when the theme “landscape” became a constant companion of my work? maybe.\n\nnevertheless, it's not my ambition to create landscape illustrations. rather, through the joy of playing with code, many different abstract structures led me to this sort of linear turbulence, which can sometimes leave a pleasant impression of “familiarity”. however, an openness that stimulates the imagination has always been important to me.\n\nsoftly morphing blob shapes traveling horizontally and leaving their trails behind. creating virtual three-dimensional forms, layered over each other, building up staggered fields out of random color sequences of partly pre-defined color arrays. mixed and overlaid with white and greyscale palettes.\nwhen some remaining colorful structures shine through, sometimes, this reminds me of thawing snow in spring, when yellow and green grasses and early bloomers, or lost toys or trash suddenly appear.\nsometimes it's the case that when the picture is built up randomly, by chance, a beautiful colorful structure is suddenly overlaid with gray again, an appropriate allegory to the concealing snow or wrapped gifts, or similar things, and for whom i consider the secret to remain hidden.\n\n...\n\ncomputer-based aesthetics have always had a strong fascination for me.\nin the early 90s, during my 2 year residency in new york i used to go into clubs and bars around the East village.  once entered a small place with electronic music playing and animations beamed onto the wall. i couldn’t stop staring at these into-each-other-morphing structures. fractals!" +
      +'Visit site.com';

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

      it('should not detect when using line breaks', async () => {
        await run(TokenStandard.Erc721, 'visit infinite.\n\nThis ');
        expect(result.detected).toStrictEqual(false);
      });

      it('should not detect text that begins with dots', async () => {
        await run(TokenStandard.Erc721, '...site');
        expect(result.detected).toStrictEqual(false);
      });

      it('should not detect phishing in long descriptions', async () => {
        await run(TokenStandard.Erc721, longDescriptionWithLink);
        expect(result.detected).toStrictEqual(false);
      });

      it('should not detect marketplace links', async () => {
        await run(TokenStandard.Erc721, 'Visit opensea.io/link');
        expect(result.detected).toStrictEqual(false);
      });

      it('should not detect links in names', async () => {
        await run(TokenStandard.Erc721, "Visit art symbolizing A.A.Murakami's Mataverse");
        expect(result.detected).toStrictEqual(false);
      });

      it('should not detect phishing with multiple social media links', async () => {
        await run(TokenStandard.Erc721, 'Visit our telegram, twitter and facebook. site.com');
        expect(result.detected).toStrictEqual(false);
      });

      it('should detect short urls', async () => {
        await run(TokenStandard.Erc721, 'Visit t.ly/N-6G');
        expect(result.detected).toStrictEqual(true);
        expect(result.metadata!.urls).toHaveLength(1);
        expect(result.metadata!.urls).toContain('t.ly/n-6g');
      });

      it('should detect multiple urls', async () => {
        await run(TokenStandard.Erc721, 'Visit t.ly/N-6G or https://site.cc');
        expect(result.detected).toStrictEqual(true);
        expect(result.metadata!.urls).toHaveLength(2);
        expect(result.metadata!.urls).toContain('t.ly/n-6g');
        expect(result.metadata!.urls).toContain('site.cc');
      });

      it('should not extract "(" and ")" symbols in url', async () => {
        await run(TokenStandard.Erc721, 'Visit our discord (https://discord.gg/av66rnpc).//');
        expect(result.detected).toStrictEqual(true);
        expect(result.metadata!.urls).toHaveLength(1);
        expect(result.metadata!.urls).toContain('discord.gg/av66rnpc');
      });

      it('should extract links correctly from markdown document', async () => {
        await run(
          TokenStandard.Erc721,
          'Visit our [discord.gg/adidas](https://discord.gg/adidas).//',
        );
        expect(result.detected).toStrictEqual(true);
        expect(result.metadata!.urls).toHaveLength(1);
        expect(result.metadata!.urls).toContain('discord.gg/adidas');
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
        await run(TokenStandard.Erc721, 'You have received $ 1,000. site.com');
        expect(result.detected).toStrictEqual(true);
        expect(result.metadata!.urls).toHaveLength(1);
        expect(result.metadata!.urls).toContain('site.com');
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

      it('should not detect phishing in long descriptions', async () => {
        await run(TokenStandard.Erc1155, longDescriptionWithLink);
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
        await run(TokenStandard.Erc1155, 'You have received $100. Its located there: site.com');
        expect(result.detected).toStrictEqual(true);
        expect(result.metadata!.urls).toHaveLength(1);
        expect(result.metadata!.urls).toContain('site.com');
      });

      it('should extract links correctly from markdown document', async () => {
        await run(
          TokenStandard.Erc1155,
          'Visit our [discord.gg/adidas](https://discord.gg/adidas).//',
        );
        expect(result.detected).toStrictEqual(true);
        expect(result.metadata!.urls).toHaveLength(1);
        expect(result.metadata!.urls).toContain('discord.gg/adidas');
      });

      it('should detect multiple urls', async () => {
        await run(
          TokenStandard.Erc1155,
          'Visit site.com or https://bit.ly/shortlink#test?query=id',
        );
        expect(result.detected).toStrictEqual(true);
        expect(result.metadata!.urls).toHaveLength(2);
        expect(result.metadata!.urls).toContain('site.com');
        expect(result.metadata!.urls).toContain('bit.ly/shortlink#test?query=id');
      });
    });
  });
});
