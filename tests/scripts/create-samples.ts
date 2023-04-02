import { shuffle } from 'lodash';
import { Network } from 'forta-agent';
import lodash from 'lodash';

import { TokenStandard } from '../../src/types';
import { getTestTokenStorage, getTokenStorage, TokenRecord } from '../utils/storages';
import { TARGET_NETWORKS } from './contants';

const LIMIT = 800; // max tokens per category

const uniq = (...dataArrays: TokenRecord[][]) =>
  lodash.uniqBy(dataArrays.flat(), (e) => e.contract);

function filterTokens(tokens: TokenRecord[]) {
  let goodToken20Airdrop = [];
  let goodToken20NoAirdrop = [];
  let spamToken20 = [];
  let goodToken721Airdrop = [];
  let goodToken721NoAirdrop = [];
  let spamToken721 = [];
  let goodToken1155Airdrop = [];
  let goodToken1155NoAirdrop = [];
  let spamToken1155 = [];

  for (const token of tokens) {
    if (token.type === TokenStandard.Erc20) {
      if (token.spam) spamToken20.push(token);
      else {
        if (token.airdrop) goodToken20Airdrop.push(token);
        else goodToken20NoAirdrop.push(token);
      }
    } else if (token.type === TokenStandard.Erc721) {
      if (token.spam) spamToken721.push(token);
      else {
        if (token.airdrop) goodToken721Airdrop.push(token);
        else goodToken721NoAirdrop.push(token);
      }
    } else if (token.type === TokenStandard.Erc1155) {
      if (token.spam) spamToken1155.push(token);
      else {
        if (token.airdrop) goodToken1155Airdrop.push(token);
        else goodToken1155NoAirdrop.push(token);
      }
    }
  }

  return {
    goodToken20Airdrop,
    goodToken20NoAirdrop,
    spamToken20,
    goodToken721Airdrop,
    goodToken721NoAirdrop,
    spamToken721,
    goodToken1155Airdrop,
    goodToken1155NoAirdrop,
    spamToken1155,
  };
}

function printTokens(title: string, tokens: TokenRecord[]) {
  const {
    goodToken20Airdrop,
    goodToken20NoAirdrop,
    spamToken20,
    goodToken721Airdrop,
    goodToken721NoAirdrop,
    spamToken721,
    goodToken1155Airdrop,
    goodToken1155NoAirdrop,
    spamToken1155,
  } = filterTokens(tokens);

  console.log(`--------------------------------`);
  console.log(`${title} (${tokens.length})`);
  console.log(`ERC20 Airdrop: ${goodToken20Airdrop.length}`);
  console.log(`ERC20 No Airdrop: ${goodToken20NoAirdrop.length}`);
  console.log(`ERC20 Spam: ${spamToken20.length}`);
  console.log(`ERC721 Airdrop: ${goodToken721Airdrop.length}`);
  console.log(`ERC721 No Airdrop: ${goodToken721NoAirdrop.length}`);
  console.log(`ERC721 Spam: ${spamToken721.length}`);
  console.log(`ERC1155 Airdrop: ${goodToken1155Airdrop.length}`);
  console.log(`ERC1155 No Airdrop: ${goodToken1155NoAirdrop.length}`);
  console.log(`ERC1155 Spam: ${spamToken1155.length}`);
}

async function append() {
  for (const network of TARGET_NETWORKS) {
    const tokens = await getTokenStorage(network).read();

    const testStorage = getTestTokenStorage(network);
    let testTokens = await testStorage.read();

    const tokenClusters = filterTokens(tokens);
    const testTokenClusters = filterTokens(testTokens);

    const goodToken20Airdrop = uniq(
      testTokenClusters.goodToken20Airdrop,
      tokenClusters.goodToken20Airdrop,
    ).slice(0, LIMIT);

    const goodToken20NoAirdrop = uniq(
      testTokenClusters.goodToken20NoAirdrop,
      tokenClusters.goodToken20NoAirdrop,
    ).slice(0, LIMIT);

    const spamToken20 = uniq(testTokenClusters.spamToken20, tokenClusters.spamToken20).slice(
      0,
      LIMIT,
    );

    const goodToken721Airdrop = uniq(
      testTokenClusters.goodToken721Airdrop,
      tokenClusters.goodToken721Airdrop,
    ).slice(0, LIMIT);
    const goodToken721NoAirdrop = uniq(
      testTokenClusters.goodToken721NoAirdrop,
      tokenClusters.goodToken721NoAirdrop,
    ).slice(0, LIMIT);
    const spamToken721 = uniq(testTokenClusters.spamToken721, tokenClusters.spamToken721).slice(
      0,
      LIMIT,
    );
    const goodToken1155Airdrop = uniq(
      testTokenClusters.goodToken1155Airdrop,
      tokenClusters.goodToken1155Airdrop,
    ).slice(0, LIMIT);
    const goodToken1155NoAirdrop = uniq(
      testTokenClusters.goodToken1155NoAirdrop,
      tokenClusters.goodToken1155NoAirdrop,
    ).slice(0, LIMIT);
    const spamToken1155 = uniq(testTokenClusters.spamToken1155, tokenClusters.spamToken1155).slice(
      0,
      LIMIT,
    );

    testTokens = [
      goodToken20Airdrop,
      goodToken20NoAirdrop,
      spamToken20,
      goodToken721Airdrop,
      goodToken721NoAirdrop,
      spamToken721,
      goodToken1155Airdrop,
      goodToken1155NoAirdrop,
      spamToken1155,
    ].flat();

    printTokens(`${Network[network]} | Test DB`, testTokens);

    await testStorage.write(testTokens);
  }
}

async function main() {
  for (const network of TARGET_NETWORKS) {
    const tokens = await getTokenStorage(network).read();

    printTokens(`${Network[network]} | Token DB`, tokens);

    const testStorage = getTestTokenStorage(network);
    let testTokens = await testStorage.read();

    if (testTokens.length === 0) {
      console.log(`Creating samples...`);

      let {
        goodToken20Airdrop,
        goodToken20NoAirdrop,
        spamToken20,
        goodToken721Airdrop,
        goodToken721NoAirdrop,
        spamToken721,
        goodToken1155Airdrop,
        goodToken1155NoAirdrop,
        spamToken1155,
      } = filterTokens(tokens);

      goodToken20Airdrop = shuffle(goodToken20Airdrop).slice(0, LIMIT);
      goodToken20NoAirdrop = shuffle(goodToken20NoAirdrop).slice(0, LIMIT);
      spamToken20 = shuffle(spamToken20).slice(0, LIMIT);
      goodToken721Airdrop = shuffle(goodToken721Airdrop).slice(0, LIMIT);
      goodToken721NoAirdrop = shuffle(goodToken721NoAirdrop).slice(0, LIMIT);
      spamToken721 = shuffle(spamToken721).slice(0, LIMIT);
      goodToken1155Airdrop = shuffle(goodToken1155Airdrop).slice(0, LIMIT);
      goodToken1155NoAirdrop = shuffle(goodToken1155NoAirdrop).slice(0, LIMIT);
      spamToken1155 = shuffle(spamToken1155).slice(0, LIMIT);

      testTokens = [
        goodToken20Airdrop,
        goodToken20NoAirdrop,
        spamToken20,
        goodToken721Airdrop,
        goodToken721NoAirdrop,
        spamToken721,
        goodToken1155Airdrop,
        goodToken1155NoAirdrop,
        spamToken1155,
      ].flat();

      await testStorage.write(testTokens);
    }

    printTokens(`${Network[network]} | Test DB`, testTokens);
  }
}

main().catch((e) => {
  console.error(e);
  return 1;
});
