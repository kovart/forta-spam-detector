import { ethers } from 'ethers';
import { omit } from 'lodash';

import SqlDatabase, { TokenInsertEvent } from './database';
import {
  Erc1155ApprovalForAllEvent,
  Erc1155TransferBatchEvent,
  Erc1155TransferSingleEvent,
  Erc20ApprovalEvent,
  Erc20TransferEvent,
  Erc721ApprovalEvent,
  Erc721ApprovalForAllEvent,
  Erc721TransferEvent,
  SimplifiedTransaction,
  TokenContract,
  TokenEvent,
  TokenStandard,
} from './types';

const autoAddress = (
  (i) => () =>
    ethers.utils.hexZeroPad('0xAbCdEf' + i++, 20)
)(0);
const autoTxHash = (
  (i) => () =>
    ethers.utils.hexZeroPad('0xFfAaEe' + i++, 32)
)(0);

describe('sql database', () => {
  const db = new SqlDatabase(':memory:');

  beforeAll(async () => {
    await db.initialize();
  });

  async function testEvents<T extends TokenEvent>(params: {
    init: (transactionId: number, token: TokenContract) => TokenInsertEvent<T>[];
    add: (event: TokenInsertEvent<T>) => void;
    get: (token: TokenContract) => Promise<object[]>;
  }) {
    const { init, add, get } = params;

    const someContract = autoAddress();

    const token: TokenContract = {
      deployer: autoAddress(),
      address: autoAddress(),
      timestamp: 1234,
      blockNumber: 12355,
      type: TokenStandard.Erc20,
    };

    const tx: SimplifiedTransaction = {
      from: autoAddress(),
      to: someContract,
      sighash: '0xa9059cbb',
      timestamp: 1e8,
      blockNumber: 1234,
      hash: autoTxHash(),
    };

    const transactionId = await db.addTransaction(tx);

    const events = init(transactionId, token);

    db.addToken(token);
    for (const event of events) {
      add(event);
    }

    const result = await get(token);

    expect(result).toHaveLength(events.length);
    for (const item of result) {
      expect(result).toContainEqual({ ...omit(item, 'transaction_id'), transaction: tx });
    }
  }

  it('should add and get token', async () => {
    const token: TokenContract = {
      address: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
      timestamp: 1234,
      blockNumber: 123455,
      type: TokenStandard.Erc20,
      deployer: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    };

    db.addToken(token);

    const result = await db.getTokens();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(token);
  });

  it('should add and get transaction', async () => {
    const contract = autoAddress();

    const tx1: SimplifiedTransaction = {
      from: autoAddress(),
      to: contract,
      sighash: '0xa9059cbb',
      timestamp: 1234,
      blockNumber: 22222,
      hash: autoTxHash(),
    };

    const tx2: SimplifiedTransaction = {
      from: autoAddress(),
      to: contract,
      sighash: '0x',
      timestamp: 12344,
      blockNumber: 333333,
      hash: autoTxHash(),
    };

    const tx3: SimplifiedTransaction = {
      from: autoAddress(),
      to: null,
      sighash: '0x',
      timestamp: 12344,
      blockNumber: 333333,
      hash: autoTxHash(),
    };

    db.addTransaction(tx1);
    db.addTransaction(tx2);
    db.addTransaction(tx3);

    let result = await db.getTransactions({ to: contract });

    expect(result).toHaveLength(2);
    expect(result).toContainEqual(tx1);
    expect(result).toContainEqual(tx2);

    result = await db.getTransactions({ to: null });

    expect(result).toHaveLength(1);
    expect(result).toContainEqual(tx3);
  });

  it('should add and get ERC20 Transfer events', async () => {
    await testEvents<Erc20TransferEvent>({
      init: (transactionId, token) => [
        {
          from: autoAddress(),
          to: autoAddress(),
          contract: token.address,
          transaction_id: transactionId,
          value: BigInt('123'),
        },
        {
          from: autoAddress(),
          to: autoAddress(),
          contract: token.address,
          transaction_id: transactionId,
          value: BigInt('12123124324235345693496834968340869348693468463089643098346'),
        },
      ],
      add: (event) => db.addErc20TransferEvent(event),
      get: (token) => db.getErc20TransferEvents({ contract: token.address }),
    });
  });

  it('should add and get ERC20 Approval events', async () => {
    await testEvents<Erc20ApprovalEvent>({
      init: (transactionId, token) => [
        {
          owner: autoAddress(),
          spender: autoAddress(),
          contract: token.address,
          transaction_id: transactionId,
          value: BigInt('123'),
        },
        {
          owner: autoAddress(),
          spender: autoAddress(),
          contract: token.address,
          transaction_id: transactionId,
          value: BigInt('12123124324235345693496834968340869348693468463089643098346'),
        },
      ],
      add: (event) => db.addErc20ApprovalEvent(event),
      get: (token) => db.getErc20ApprovalEvents({ contract: token.address }),
    });
  });

  it('should add and get Erc721 Transfer events', async () => {
    await testEvents<Erc721TransferEvent>({
      init: (transactionId, token) => [
        {
          from: autoAddress(),
          to: autoAddress(),
          contract: token.address,
          transaction_id: transactionId,
          tokenId: '123546745745765856865865756457546653443554354453366356535723242343266545',
        },
        {
          from: autoAddress(),
          to: autoAddress(),
          contract: token.address,
          transaction_id: transactionId,
          tokenId: '7642',
        },
      ],
      add: (event) => db.addErc721TransferEvent(event),
      get: (token) => db.getErc721TransferEvents({ contract: token.address }),
    });
  });

  it('should add and get Erc721 Approval events', async () => {
    await testEvents<Erc721ApprovalEvent>({
      init: (transactionId, token) => [
        {
          owner: autoAddress(),
          approved: autoAddress(),
          contract: token.address,
          transaction_id: transactionId,
          tokenId: '12345',
        },
        {
          owner: autoAddress(),
          approved: autoAddress(),
          contract: token.address,
          transaction_id: transactionId,
          tokenId: '7642',
        },
      ],
      add: (event) => db.addErc721ApprovalEvent(event),
      get: (token) => db.getErc721ApprovalEvents({ contract: token.address }),
    });
  });

  it('should add and get Erc721 ApprovalForAll events', async () => {
    await testEvents<Erc721ApprovalForAllEvent>({
      init: (transactionId, token) => [
        {
          owner: autoAddress(),
          operator: autoAddress(),
          approved: false,
          contract: token.address,
          transaction_id: transactionId,
        },
        {
          owner: autoAddress(),
          operator: autoAddress(),
          approved: true,
          contract: token.address,
          transaction_id: transactionId,
        },
      ],
      add: (event) => db.addErc721ApprovalForAllEvent(event),
      get: (token) => db.getErc721ApprovalForAllEvents({ contract: token.address }),
    });
  });

  it('should add and get Erc1155 TransferSingle events', async () => {
    await testEvents<Erc1155TransferSingleEvent>({
      init: (transactionId, token) => [
        {
          from: autoAddress(),
          to: autoAddress(),
          operator: autoAddress(),
          tokenId: '0',
          value: BigInt('0'),
          contract: token.address,
          transaction_id: transactionId,
        },
        {
          from: autoAddress(),
          to: autoAddress(),
          operator: autoAddress(),
          tokenId: '1234556745756765867876876768786784755564654546645',
          value: BigInt('12344378678678678678678679789789879789879789789789789'),
          contract: token.address,
          transaction_id: transactionId,
        },
      ],
      add: (event) => db.addErc1155TransferSingleEvent(event),
      get: (token) => db.getErc1155TransferSingleEvents({ contract: token.address }),
    });
  });

  it('should add and get Erc1155 TransferBatch events', async () => {
    await testEvents<Erc1155TransferBatchEvent>({
      init: (transactionId, token) => [
        {
          from: autoAddress(),
          to: autoAddress(),
          operator: autoAddress(),
          ids: ['0', '123124325235'],
          values: [BigInt('0'), BigInt('12344378678678678678678679789789879789879789789789789')],
          contract: token.address,
          transaction_id: transactionId,
        },
        {
          from: autoAddress(),
          to: autoAddress(),
          operator: autoAddress(),
          ids: ['0', '123124325235'],
          values: [BigInt('0'), BigInt('1')],
          contract: token.address,
          transaction_id: transactionId,
        },
      ],
      add: (event) => db.addErc1155TransferBatchEvent(event),
      get: (token) => db.getErc1155TransferBatchEvents({ contract: token.address }),
    });
  });

  it('should add and get Erc1155 ApprovalForAll events', async () => {
    await testEvents<Erc1155ApprovalForAllEvent>({
      init: (transactionId, token) => [
        {
          owner: autoAddress(),
          operator: autoAddress(),
          approved: false,
          contract: token.address,
          transaction_id: transactionId,
        },
        {
          owner: autoAddress(),
          operator: autoAddress(),
          approved: true,
          contract: token.address,
          transaction_id: transactionId,
        },
      ],
      add: (event) => db.addErc1155ApprovalForAllEvent(event),
      get: (token) => db.getErc1155ApprovalForAllEvents({ contract: token.address }),
    });
  });

  it('should clear token data', async () => {
    // Prepare data

    const commonDeployer = autoAddress();

    const token1: TokenContract = {
      deployer: commonDeployer,
      address: autoAddress(),
      timestamp: 1234,
      blockNumber: 12355,
      type: TokenStandard.Erc20,
    };

    db.addToken(token1);

    const token1Tx1: SimplifiedTransaction = {
      from: autoAddress(),
      to: autoAddress(),
      sighash: '0xa9059cbb',
      timestamp: 1e8,
      blockNumber: 1234,
      hash: autoTxHash(),
    };

    const tx1Id = await db.addTransaction(token1Tx1);

    const token1ApprovalEvent = {
      owner: autoAddress(),
      spender: autoAddress(),
      contract: token1.address,
      transaction_id: tx1Id,
      value: BigInt('654'),
    };

    db.addErc20ApprovalEvent(token1ApprovalEvent);

    const token1Tx2: SimplifiedTransaction = {
      from: autoAddress(),
      to: token1.address,
      sighash: '0xa9059cbb',
      timestamp: 1e8,
      blockNumber: 1234,
      hash: autoTxHash(),
    };

    const tx2Id = await db.addTransaction(token1Tx2);

    const token1TransferEvent = {
      from: autoAddress(),
      to: autoAddress(),
      contract: token1.address,
      transaction_id: tx2Id,
      value: BigInt('123'),
    };

    db.addErc20TransferEvent(token1TransferEvent);

    const token2: TokenContract = {
      deployer: commonDeployer,
      address: autoAddress(),
      timestamp: 12344,
      blockNumber: 1238,
      type: TokenStandard.Erc20,
    };

    const token2Tx: SimplifiedTransaction = {
      from: autoAddress(),
      to: autoAddress(),
      sighash: '0xa9059cbb',
      timestamp: 1e8,
      blockNumber: 1234,
      hash: autoTxHash(),
    };

    db.addToken(token2);

    const tx3Id = await db.addTransaction(token2Tx);

    const token2TransferEvent = {
      from: autoAddress(),
      to: autoAddress(),
      contract: token2.address,
      transaction_id: tx3Id,
      value: BigInt('123'),
    };

    db.addErc20TransferEvent(token2TransferEvent);

    // Check correctness before

    let allTokens = await db.getTokens();
    let txsToSomeContract = await db.getTransactions({ to: token1Tx1.to });
    let txsToToken1 = await db.getTransactions({ to: token1.address });
    let token1TransferEvents = await db.getErc20TransferEvents({ contract: token1.address });
    let token1ApprovalEvents = await db.getErc20ApprovalEvents({ contract: token1.address });
    let token2TransferEvents = await db.getErc20TransferEvents({ contract: token2.address });

    expect(allTokens).toContainEqual(token1);
    expect(allTokens).toContainEqual(token2);
    expect(txsToSomeContract).toHaveLength(1);
    expect(txsToSomeContract[0]).toEqual(token1Tx1);
    expect(txsToToken1).toHaveLength(1);
    expect(txsToToken1[0]).toEqual(token1Tx2);
    expect(token1ApprovalEvents).toHaveLength(1);
    expect(token1ApprovalEvents).toContainEqual({
      ...omit(token1ApprovalEvent, 'transaction_id'),
      transaction: token1Tx1,
    });
    expect(token1TransferEvents).toHaveLength(1);
    expect(token1TransferEvents).toContainEqual({
      ...omit(token1TransferEvent, 'transaction_id'),
      transaction: token1Tx2,
    });
    expect(token2TransferEvents).toHaveLength(1);
    expect(token2TransferEvents).toContainEqual({
      ...omit(token2TransferEvent, 'transaction_id'),
      transaction: token2Tx,
    });

    // Clear token1

    db.clearToken(token1.address);

    // Check result
    allTokens = await db.getTokens();
    txsToSomeContract = await db.getTransactions({ to: token1Tx1.to });
    txsToToken1 = await db.getTransactions({ to: token1.address });
    token1TransferEvents = await db.getErc20TransferEvents({ contract: token1.address });
    token1ApprovalEvents = await db.getErc20ApprovalEvents({ contract: token1.address });

    const dbAddresses = (await db.getAddresses()).map((a) => a.address);

    const shouldBePresentAddresses = [
      token2.address,
      token2.deployer,
      token2TransferEvent.from,
      token2TransferEvent.to,
    ];

    const shouldBeRemovedAddresses = [
      token1.address,
      token1Tx1.from,
      token1Tx1.to,
      token1ApprovalEvent.owner,
      token1ApprovalEvent.spender,
      token1Tx2.from,
      token1Tx2.to,
      token1TransferEvent.from,
      token1TransferEvent.to,
    ];

    expect(allTokens).not.toContainEqual(token1);
    expect(txsToSomeContract).toHaveLength(0);
    expect(txsToToken1).toHaveLength(0);
    expect(token1ApprovalEvents).toHaveLength(0);
    expect(token1TransferEvents).toHaveLength(0);
    for (const address of shouldBePresentAddresses) {
      expect(dbAddresses).toContain(address);
    }
    for (const address of shouldBeRemovedAddresses) {
      expect(dbAddresses).not.toContain(address);
    }
  });
});
