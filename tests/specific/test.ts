import { ethers } from 'ethers';
import { Network } from 'forta-agent';

import { SpamDetector } from '../../src/detector';
import { PUBLIC_RPC_URLS_BY_NETWORK } from '../../src/contants';
import { Token } from './types';
import { getBlocks } from './utils';
import { TokenStandard } from '../../src/types';
import { formatDate } from '../helpers';

const TICK_INTERVAL = 4 * 60 * 60; // 4h

async function testToken(token: Token, isSpam: boolean) {
  const provider = new ethers.providers.JsonRpcBatchProvider(
    PUBLIC_RPC_URLS_BY_NETWORK[token.network][0],
  );

  const blockEvents = await getBlocks(token);

  const detector = new SpamDetector(provider, TICK_INTERVAL);

  detector.addTokenToWatchList(token.type, {
    address: token.address,
    blockNumber: token.blockNumber,
    timestamp: token.timestamp,
    deployer: token.deployer,
  });

  let waitedAt = 0;
  let finalIsSpam = false;
  for (let i = 0; i < blockEvents.length; i++) {
    const block = blockEvents[i];
    const txEvents = block.txEvents;

    for (const txEvent of txEvents) {
      detector.handleTxEvent(txEvent);
    }

    detector.tick(block.timestamp, block.number);

    if (waitedAt - block.timestamp > TICK_INTERVAL) {
      await detector.wait();

      waitedAt = block.timestamp;

      const analyses = detector.releaseAnalyses();

      const { result } = analyses[0];
      const { isSpam, isFinalized } = result.interpret();

      console.log(
        `${token.address} | ${formatDate(block.timestamp)} | Is Spam: ${isSpam}`,
        JSON.stringify(result, null, '  '),
      );

      finalIsSpam = isSpam;

      if (isFinalized) {
        console.log(`${token.address} | Finalized`);
        break;
      }
    }
  }

  console.log(`${token.address} | Test passed: ${finalIsSpam == isSpam}`);
}

async function main() {
  await testToken(
    {
      address: '0xfb0c0abde2f2feb37f6c177929e3db9d3ad77e24',
      deployer: '0x6a72bfe4bf2fede44db0b2f2c31d1addd2c95f65',
      timestamp: 1681383325,
      blockNumber: 27310184,
      network: Network.BSC,
      type: TokenStandard.Erc721,
    },
    false,
  );
}

main().then((e) => {
  console.error(e);
});
