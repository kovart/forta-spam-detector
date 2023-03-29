import { TransactionEvent } from 'forta-agent';
import { Contract, ethers, providers, utils } from 'ethers';

import Logger from './logger';
import { CreatedContract, TokenStandard } from '../types';
import {
  erc1155Iface,
  erc165Iface,
  erc20Iface,
  erc721Iface,
  INTERFACE_ID_BY_TYPE,
} from '../contants';

export function findCreatedContracts(txEvent: TransactionEvent): CreatedContract[] {
  const createdContracts: CreatedContract[] = [];

  const sender = txEvent.from.toLowerCase();

  for (const trace of txEvent.traces) {
    if (trace.type === 'create') {
      const deployer = trace.action.from.toLowerCase();

      // Parity/OpenEthereum trace format contains created address
      // https://github.com/NethermindEth/docs/blob/master/nethermind-utilities/cli/trace.md
      if (trace.result.address) {
        createdContracts.push({
          deployer: deployer,
          address: trace.result.address.toLowerCase(),
          blockNumber: txEvent.blockNumber,
          timestamp: txEvent.timestamp,
        });
        continue;
      }

      // Fallback to more universal way

      if (sender === deployer || createdContracts.find((c) => c.address === deployer)) {
        // for contracts creating other contracts, the nonce would be 1
        const nonce = sender === deployer ? txEvent.transaction.nonce : 1;
        const createdContract = ethers.utils.getContractAddress({ from: deployer, nonce });
        createdContracts.push({
          deployer: deployer,
          address: createdContract.toLowerCase(),
          blockNumber: txEvent.blockNumber,
          timestamp: txEvent.timestamp,
        });
      }
    }
  }

  if (!txEvent.to && txEvent.traces.length === 0) {
    createdContracts.push({
      deployer: sender,
      address: ethers.utils.getContractAddress({
        from: txEvent.from,
        nonce: txEvent.transaction.nonce,
      }),
      blockNumber: txEvent.blockNumber,
      timestamp: txEvent.timestamp,
    });
  }

  return createdContracts;
}

function isCodeCompatible(
  code: string,
  iface: utils.Interface,
  items: { functions?: string[]; events?: string[] },
): boolean {
  // Get hashes and remove 0x from the beginning
  const functionSignatures = (items.functions || []).map((name) => iface.getSighash(name).slice(2));
  const eventSignatures = (items.events || []).map((name) => iface.getEventTopic(name).slice(2));

  // check if code includes all the signatures
  return ![...functionSignatures, ...eventSignatures].find((hash) => !code.includes(hash));
}

export async function identifyTokenInterface(
  contractAddress: string,
  provider: providers.JsonRpcProvider,
  logger: (...args: any) => void = () => {},
): Promise<TokenStandard | null> {
  // First of all, let's check with erc165 as it's the most accurate way

  logger('Trying to identify interface with the ERC165');

  const erc165Contract = new Contract(contractAddress, erc165Iface, provider);

  try {
    const tokenInterface = (
      await Promise.all(
        [TokenStandard.Erc1155, TokenStandard.Erc721, TokenStandard.Erc20].map(
          async (standard) => ({
            standard: standard,
            isSupported: await erc165Contract.supportsInterface(INTERFACE_ID_BY_TYPE[standard]),
          }),
        ),
      )
    ).find((v) => v.isSupported);

    if (tokenInterface) return tokenInterface.standard;
  } catch {
    // erc165 is not supported
  }

  // Let's check by function and event signatures inside the contract bytecode.
  // This method works if the contract doesn't use proxies.

  logger('Trying to identify interface using contract bytecode');

  const code = await provider.getCode(contractAddress);

  // https://eips.ethereum.org/EIPS/eip-20
  const isErc20 = isCodeCompatible(code, erc20Iface, {
    functions: ['balanceOf', 'allowance', 'approve', 'transfer', 'transferFrom', 'totalSupply'],
    events: ['Transfer', 'Approval'],
  });
  if (isErc20) {
    if (
      isCodeCompatible(code, erc20Iface, { functions: ['symbol'] }) ||
      isCodeCompatible(code, erc20Iface, { functions: ['name'] })
    ) {
      return TokenStandard.Erc20;
    }

    return null;
  }

  // https://eips.ethereum.org/EIPS/eip-721
  // 'safeTransferFrom' is ignored due to its overloading
  const isErc721 = isCodeCompatible(code, erc721Iface, {
    functions: [
      'balanceOf',
      'ownerOf',
      'transferFrom',
      'approve',
      'setApprovalForAll',
      'getApproved',
      'isApprovedForAll',
    ],
    events: ['Transfer', 'Approval', 'ApprovalForAll'],
  });
  if (isErc721) {
    if (
      isCodeCompatible(code, erc721Iface, { functions: ['symbol'] }) ||
      isCodeCompatible(code, erc721Iface, { functions: ['name'] })
    ) {
      return TokenStandard.Erc721;
    }

    return null;
  }

  // https://eips.ethereum.org/EIPS/eip-1155
  // TODO For unknown reasons, signature of 'balanceOf' cannot be found in the bytecode of ERC1155 contracts
  const isErc1155 = isCodeCompatible(code, erc1155Iface, {
    functions: [
      'safeTransferFrom',
      'safeBatchTransferFrom',
      'balanceOfBatch',
      'setApprovalForAll',
      'isApprovedForAll',
    ],
    events: ['TransferSingle', 'TransferBatch', 'ApprovalForAll'],
  });

  if (isErc1155) return TokenStandard.Erc1155;

  logger('Trying to identify ERC20 interface using duck typing');

  try {
    const address1 = utils.hexZeroPad('0x1', 20);
    const address2 = utils.hexZeroPad('0x2', 20);
    const erc20contract = new Contract(contractAddress, erc20Iface, provider);
    await Promise.all([
      erc20contract.balanceOf(address1),
      erc20contract.totalSupply(),
      erc20contract.allowance(address1, address2),
    ]);

    // success if at least one function is fulfilled
    await Promise.any([erc20contract.symbol(), erc20contract.name()]);

    return TokenStandard.Erc20;
  } catch (e) {
    // not erc20 interface
  }

  return null;
}

export const delay = (ms: number): Promise<unknown> => new Promise((res) => setTimeout(res, ms));

export async function retry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; wait?: number },
): Promise<T> {
  const { attempts = 3, wait = 5 * 1000 } = opts || {};
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      // eslint-disable-next-line no-console
      Logger.info(`Attempt (${attempt}/${attempts}):`, e?.message || e?.details || e?.code || e);
      if (attempt >= attempts) {
        return e;
      }
      attempt++;
      await delay(wait);
    }
  }
}

export function normalizeMetadataUri(uri: string): string | null {
  // The URI can have the following formats:
  // QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o
  // /ipfs/QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o
  // ://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o
  // https://ipfs.io/ipfs/QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o
  // http://bafybeie5gq4jxvzmsym6hjlwxej4rwdoxt7wadqvmmwbqi7r27fclha2va.dweb.link
  // https://site.com/test.json#234?a=3

  const gatewayUrl = 'https://ipfs.io/ipfs/';

  if (containsLink(uri)) {
    return uri;
  } else if (uri.indexOf('ipfs://') === 0) {
    return uri.replace('ipfs://', gatewayUrl);
  } else if (uri.indexOf('://') === 0) {
    return uri.replace('://', gatewayUrl);
  } else if (uri.indexOf('://ipfs/')) {
    return uri.replace('://ipfs/', gatewayUrl);
  } else if (uri.indexOf('/ipfs/') === 0) {
    return uri.replace('/ipfs/', gatewayUrl);
  } else if (isCid(uri)) {
    return gatewayUrl + uri;
  }

  Logger.info('Cannot recognize URI format: ' + uri);

  return null;
}

export function isBase64(str: string) {
  return str.trim().indexOf('data:application/json') === 0;
}

export function parseBase64(data: string): object | null {
  const json = Buffer.from(data.substring(29), 'base64').toString();
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

export function containsLink(str: string): boolean {
  return /(http(s)?:\/\/.)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/.test(
    str,
  );
}

export function isCid(str: string) {
  return /^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[A-Za-z2-7]{58,}|B[A-Z2-7]{58,}|z[1-9A-HJ-NP-Za-km-z]{48,}|F[0-9A-F]{50,})$/.test(
    str,
  );
}
