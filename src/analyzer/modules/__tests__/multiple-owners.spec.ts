import { MockEthersProvider } from 'forta-agent-tools/lib/test';
import { ethers } from 'ethers';

import { autoAddress } from './__utils__/helpers';
import Erc721MultipleOwnersModule, {
  Erc721MultipleOwnersModuleMetadata,
  MULTIPLE_OWNERS_MODULE_KEY,
} from '../multiple-owners';
import { ModuleAnalysisResult } from '../../types';
import { erc721Iface } from '../../../contants';
import { SimplifiedTransaction, TokenContract, TokenStandard } from '../../../types';
import DataStorage from '../../../storage';
import { createAddress } from 'forta-agent-tools';
import { AIRDROP_MODULE_KEY } from '../airdrop';

describe('Erc721MultipleOwners', () => {
  const indicator = new Erc721MultipleOwnersModule({
    minDuplicatedTokens: 1,
    minDuplicatedTokensFromSameSender: 1,
  });

  const mockStorage = {
    getErc721TransferEvents: jest.fn(),
  } as jest.MockedObject<DataStorage>;
  const mockEthersProvider = new MockEthersProvider();

  const token: TokenContract = {
    address: autoAddress(),
    deployer: autoAddress(),
    blockNumber: 1234,
    timestamp: 3e8,
    type: TokenStandard.Erc721,
  };

  let context: { [key: string]: ModuleAnalysisResult<Erc721MultipleOwnersModuleMetadata> } = {};

  beforeEach(() => {
    mockStorage.getErc721TransferEvents.mockClear();
    context = {
      [AIRDROP_MODULE_KEY]: {
        detected: true,
      },
    };
  });

  function createTransaction(params: {
    blockNumber: number;
    index?: number;
    hash?: string;
  }): SimplifiedTransaction {
    return {
      timestamp: 0,
      index: params.index ?? 0,
      blockNumber: params.blockNumber,
      to: token.address,
      from: autoAddress(),
      hash: params.hash || '0xHASH',
      sighash: '0xSIGHASH',
    };
  }

  it('should not detect if it is not ERC-721 token', async () => {
    await indicator.scan({
      provider: mockEthersProvider as unknown as ethers.providers.JsonRpcProvider,
      storage: mockStorage,
      blockNumber: 200,
      context,
      token: { ...token, type: TokenStandard.Erc1155 },
      timestamp: 0,
      transformer: null!,
      memoizer: null!,
    });

    expect(mockStorage.getErc721TransferEvents).not.toBeCalled();
    expect(context[MULTIPLE_OWNERS_MODULE_KEY].detected).toStrictEqual(false);
  });

  it('should not detect if there are no multiple owners', async () => {
    const blockNumber = 222;
    const address1 = autoAddress();
    const address2 = autoAddress();
    const address3 = autoAddress();

    // Break the order so that the indicator sorts on its own
    mockStorage.getErc721TransferEvents.mockResolvedValue([
      {
        from: address2,
        to: address3,
        tokenId: '0',
        contract: token.address,
        logIndex: 1,
        transaction: createTransaction({ blockNumber, index: 1 }),
      },
      {
        from: address1,
        to: address2,
        tokenId: '0',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber, index: 0 }),
      },
      {
        from: address1,
        to: address2,
        tokenId: '1',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber, index: 0 }),
      },
      {
        from: address2,
        to: address3,
        tokenId: '1',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 2 }),
      },
      {
        from: address3,
        to: address2,
        tokenId: '0',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 1 }),
      },
    ]);

    await indicator.scan({
      provider: mockEthersProvider as unknown as ethers.providers.JsonRpcProvider,
      storage: mockStorage,
      blockNumber: blockNumber + 2,
      context,
      token,
      timestamp: 0,
      transformer: null!,
      memoizer: null!,
    });

    expect(context[MULTIPLE_OWNERS_MODULE_KEY].detected).toStrictEqual(false);
  });

  it('should not detect duplication caused by dropped tx', async () => {
    const blockNumber = 222;
    const address1 = autoAddress();
    const address2 = autoAddress();
    const address3 = autoAddress();
    const tokenId = '0';

    mockStorage.getErc721TransferEvents.mockResolvedValue([
      {
        from: address1,
        to: address2,
        tokenId: tokenId,
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber, index: 0 }),
      },
      // Let's assume there is a dropped event here (address2 -> address3)
      {
        from: address3,
        to: address2,
        tokenId: tokenId,
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 2 }),
      },
    ]);

    mockEthersProvider.addCallTo(token.address, blockNumber + 1, erc721Iface, 'ownerOf', {
      inputs: [tokenId],
      outputs: [address3],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 2, erc721Iface, 'ownerOf', {
      inputs: [tokenId],
      outputs: [address2],
    });

    await indicator.scan({
      provider: mockEthersProvider as unknown as ethers.providers.JsonRpcProvider,
      storage: mockStorage,
      blockNumber: blockNumber + 2,
      context,
      token,
      timestamp: 0,
      transformer: null!,
      memoizer: null!,
    });

    expect(context[MULTIPLE_OWNERS_MODULE_KEY].detected).toStrictEqual(false);
  });

  it('should detect if NFT was minted to multiple owners', async () => {
    const blockNumber = 222;
    const zeroAddress = ethers.constants.AddressZero;
    const address1 = autoAddress();
    const address2 = autoAddress();
    const tokenId = '0';

    mockStorage.getErc721TransferEvents.mockResolvedValue([
      {
        from: zeroAddress,
        to: address1,
        tokenId: tokenId,
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber }),
      },
      {
        from: zeroAddress,
        to: address2,
        tokenId: tokenId,
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 1 }),
      },
    ]);

    // Usually, in such spam, the owner is the account on which the first mint was made
    mockEthersProvider.addCallTo(token.address, blockNumber, erc721Iface, 'ownerOf', {
      inputs: [tokenId],
      outputs: [address1],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 1, erc721Iface, 'ownerOf', {
      inputs: [tokenId],
      outputs: [address1],
    });

    await indicator.scan({
      provider: mockEthersProvider as unknown as ethers.providers.JsonRpcProvider,
      storage: mockStorage,
      blockNumber: blockNumber + 100,
      context,
      token,
      timestamp: 0,
      transformer: null!,
      memoizer: null!,
    });

    expect(context[MULTIPLE_OWNERS_MODULE_KEY].detected).toStrictEqual(true);
  });

  it('should detect if NFT was transferred multiple times to same owner', async () => {
    const blockNumber = 222;
    const address1 = autoAddress();
    const address2 = autoAddress();
    const address3 = autoAddress();
    const tokenId = '0';

    mockStorage.getErc721TransferEvents.mockResolvedValue([
      {
        from: address1,
        to: address3,
        tokenId: tokenId,
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber }),
      },
      {
        from: address2,
        to: address3,
        tokenId: tokenId,
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 1 }),
      },
    ]);

    mockEthersProvider.addCallTo(token.address, blockNumber, erc721Iface, 'ownerOf', {
      inputs: [tokenId],
      outputs: [address3],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 1, erc721Iface, 'ownerOf', {
      inputs: [tokenId],
      outputs: [address3],
    });

    await indicator.scan({
      provider: mockEthersProvider as unknown as ethers.providers.JsonRpcProvider,
      storage: mockStorage,
      blockNumber: blockNumber + 1,
      context,
      token,
      timestamp: 0,
      transformer: null!,
      memoizer: null!,
    });

    expect(context[MULTIPLE_OWNERS_MODULE_KEY].detected).toStrictEqual(true);
  });

  it('should detect if NFT was transferred to multiple owners in one tx', async () => {
    const blockNumber = 222;
    const address1 = autoAddress();
    const address2 = autoAddress();
    const address3 = autoAddress();
    const tokenId = '0';

    mockStorage.getErc721TransferEvents.mockResolvedValue([
      {
        from: ethers.constants.AddressZero,
        to: address1,
        tokenId: tokenId,
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber }),
      },
      {
        from: address1,
        to: address2,
        tokenId: tokenId,
        contract: token.address,
        logIndex: 1,
        transaction: createTransaction({ blockNumber }),
      },
      {
        from: address1,
        to: address3,
        tokenId: tokenId,
        contract: token.address,
        logIndex: 2,
        transaction: createTransaction({ blockNumber }),
      },
    ]);

    await indicator.scan({
      provider: mockEthersProvider as unknown as ethers.providers.JsonRpcProvider,
      storage: mockStorage,
      blockNumber: blockNumber,
      context,
      token,
      timestamp: 0,
      transformer: null!,
      memoizer: null!,
    });

    expect(context[MULTIPLE_OWNERS_MODULE_KEY].detected).toStrictEqual(true);
  });

  it('should not detect if min number of duplicates is not satisfied', async () => {
    let indicator = new Erc721MultipleOwnersModule({
      minDuplicatedTokens: 3,
      minDuplicatedTokensFromSameSender: 2,
    });

    const blockNumber = 222;

    // 2 senders with 2 duplicated tokens
    mockStorage.getErc721TransferEvents.mockResolvedValue([
      {
        from: createAddress('0x0'),
        to: createAddress('0x1'),
        tokenId: '0',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber }),
      },
      {
        from: createAddress('0x0'),
        to: createAddress('0x2'),
        tokenId: '0',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 1 }),
      },
      {
        from: createAddress('0x1'),
        to: createAddress('0x2'),
        tokenId: '1',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber }),
      },
      {
        from: createAddress('0x1'),
        to: createAddress('0x3'),
        tokenId: '1',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 1 }),
      },
    ]);

    mockEthersProvider.addCallTo(token.address, blockNumber, erc721Iface, 'ownerOf', {
      inputs: ['0'],
      outputs: [createAddress('0x1')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 1, erc721Iface, 'ownerOf', {
      inputs: ['0'],
      outputs: [createAddress('0x1')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber, erc721Iface, 'ownerOf', {
      inputs: ['1'],
      outputs: [createAddress('0x2')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 1, erc721Iface, 'ownerOf', {
      inputs: ['1'],
      outputs: [createAddress('0x2')],
    });

    await indicator.scan({
      provider: mockEthersProvider as unknown as ethers.providers.JsonRpcProvider,
      storage: mockStorage,
      blockNumber: blockNumber + 1,
      context,
      token,
      timestamp: 0,
      transformer: null!,
      memoizer: null!,
    });

    expect(context[MULTIPLE_OWNERS_MODULE_KEY].detected).toStrictEqual(false);

    // minDuplicatedTokensFromSameSender
    // ----------------------------------------------

    indicator = new Erc721MultipleOwnersModule({
      minDuplicatedTokens: 999, // should not be satisfied
      minDuplicatedTokensFromSameSender: 2,
    });

    // 1 sender, 2 duplicates
    mockStorage.getErc721TransferEvents.mockResolvedValue([
      {
        from: createAddress('0x1'),
        to: createAddress('0x2'),
        tokenId: '0',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber }),
      },
      {
        from: createAddress('0x1'),
        to: createAddress('0x3'),
        tokenId: '0',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 1 }),
      },
      {
        from: createAddress('0x1'),
        to: createAddress('0x2'),
        tokenId: '1',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 2 }),
      },
      {
        from: createAddress('0x1'),
        to: createAddress('0x3'),
        tokenId: '1',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 3 }),
      },
    ]);

    mockEthersProvider.addCallTo(token.address, blockNumber, erc721Iface, 'ownerOf', {
      inputs: ['0'],
      outputs: [createAddress('0x2')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 1, erc721Iface, 'ownerOf', {
      inputs: ['0'],
      outputs: [createAddress('0x2')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 2, erc721Iface, 'ownerOf', {
      inputs: ['1'],
      outputs: [createAddress('0x2')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 3, erc721Iface, 'ownerOf', {
      inputs: ['1'],
      outputs: [createAddress('0x2')],
    });

    await indicator.scan({
      provider: mockEthersProvider as unknown as ethers.providers.JsonRpcProvider,
      storage: mockStorage,
      blockNumber: blockNumber + 3,
      context,
      token,
      timestamp: 0,
      transformer: null!,
      memoizer: null!,
    });

    expect(context[MULTIPLE_OWNERS_MODULE_KEY].detected).toStrictEqual(true);

    // minDuplicatedTokens
    // ----------------------------------------------

    indicator = new Erc721MultipleOwnersModule({
      minDuplicatedTokens: 3,
      minDuplicatedTokensFromSameSender: 999, // should not be satisfied
    });

    mockStorage.getErc721TransferEvents.mockResolvedValue([
      {
        from: createAddress('0x1'),
        to: createAddress('0x2'),
        tokenId: '0',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber }),
      },
      {
        from: createAddress('0x3'),
        to: createAddress('0x4'),
        tokenId: '0',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 1 }),
      },
      {
        from: createAddress('0x5'),
        to: createAddress('0x6'),
        tokenId: '1',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber }),
      },
      {
        from: createAddress('0x7'),
        to: createAddress('0x8'),
        tokenId: '1',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 1 }),
      },
      {
        from: createAddress('0x9'),
        to: createAddress('0x10'),
        tokenId: '2',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber }),
      },
      {
        from: createAddress('0x11'),
        to: createAddress('0x12'),
        tokenId: '2',
        contract: token.address,
        logIndex: 0,
        transaction: createTransaction({ blockNumber: blockNumber + 1 }),
      },
    ]);

    mockEthersProvider.addCallTo(token.address, blockNumber, erc721Iface, 'ownerOf', {
      inputs: ['0'],
      outputs: [createAddress('0x2')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 1, erc721Iface, 'ownerOf', {
      inputs: ['0'],
      outputs: [createAddress('0x2')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber, erc721Iface, 'ownerOf', {
      inputs: ['1'],
      outputs: [createAddress('0x3')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 1, erc721Iface, 'ownerOf', {
      inputs: ['1'],
      outputs: [createAddress('0x3')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber, erc721Iface, 'ownerOf', {
      inputs: ['2'],
      outputs: [createAddress('0x5')],
    });
    mockEthersProvider.addCallTo(token.address, blockNumber + 1, erc721Iface, 'ownerOf', {
      inputs: ['2'],
      outputs: [createAddress('0x5')],
    });

    await indicator.scan({
      provider: mockEthersProvider as unknown as ethers.providers.JsonRpcProvider,
      storage: mockStorage,
      blockNumber: blockNumber + 1,
      context,
      token,
      timestamp: 0,
      transformer: null!,
      memoizer: null!,
    });

    expect(context[MULTIPLE_OWNERS_MODULE_KEY].detected).toStrictEqual(true);
  });
});
