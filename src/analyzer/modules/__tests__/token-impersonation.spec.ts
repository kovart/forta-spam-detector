import { MockEthersProvider } from 'forta-agent-tools/lib/test';

import { autoAddress } from './__utils__/helpers';

import TokenImpersonationModule, { TokenImpersonationModuleMetadata } from '../token-impersonation';
import { TokenContract, TokenStandard } from '../../../types';
import Memoizer from '../../../utils/cache';
import TokenProvider from '../../../utils/tokens';
import { ModuleAnalysisResult } from '../../types';
import { erc20Iface } from '../../../contants';

describe('TokenImpersonation', () => {
  let result!: ModuleAnalysisResult<TokenImpersonationModuleMetadata>;

  const mockToken = {
    address: autoAddress(),
    deployer: autoAddress(),
    blockNumber: 1234,
    timestamp: 3e8,
    type: TokenStandard.Erc20,
  } as TokenContract;
  const mockEthersProvider = new MockEthersProvider();
  const mockTokenProvider = {
    getList: jest.fn(),
  } as jest.MockedObject<TokenProvider>;
  const indicator = new TokenImpersonationModule(mockTokenProvider);

  beforeEach(() => {
    result = undefined as any;
    mockEthersProvider.clear();
    mockTokenProvider.getList.mockClear();
  });

  async function run(token1: [string, string], token2: [string, string]) {
    const context: { [key: string]: ModuleAnalysisResult<TokenImpersonationModuleMetadata> } = {};

    const blockTag = undefined;

    mockEthersProvider.addCallTo(mockToken.address, blockTag!, erc20Iface, 'name', {
      inputs: [],
      outputs: [token2[0]],
    });
    mockEthersProvider.addCallTo(mockToken.address, blockTag!, erc20Iface, 'symbol', {
      inputs: [],
      outputs: [token2[1]],
    });

    mockTokenProvider.getList.mockResolvedValue([
      {
        name: token1[0],
        symbol: token1[1],
        deployments: { 1: autoAddress() },
        type: 'nft',
      },
    ]);

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

  it("Tornada (CASH) doesn't impersonate Tornado (CASH)", async () => {
    await run(['Tornado', 'CASH'], ['Tornada', 'CASH']);
    expect(result.detected).toStrictEqual(false);
  });

  it("Cash (CASH) doesn't impersonate Cash (CASH1)", async () => {
    await run(['Cash', 'CASH'], ['Cash', 'CASH1']);
    expect(result.detected).toStrictEqual(false);
  });

  it("Boom (BOOM) doesn't impersonates BOOM (BOOM)", async () => {
    await run(['Boom', 'BOOM'], ['BOOM', 'BOOM']);
    expect(result.detected).toStrictEqual(false);
  });

  it('Tether (USDT) impersonates Tether (USDT)', async () => {
    await run(['Tether', 'USDT'], ['Tether', 'USDT']);
    expect(result.detected).toStrictEqual(true);
  });

  it('tornadocash (CASH) impersonates Tornado Cash (cash)', async () => {
    await run(['Tornado Cash', 'cash'], ['tornadocash', 'CASH']);
    expect(result.detected).toStrictEqual(true);
  });

  it('I am Token Name (IATN) impersonates IAmTokenName (IATN)', async () => {
    await run(['IAmTokenName', 'IATN'], ['I am Token Name', 'IATN']);
    expect(result.detected).toStrictEqual(true);
  });

  it('Tornadoċash (CAѕH) impersonates Tornado Cash (CASH)', async () => {
    await run(['Tornado Cash', 'CASH'], ['Tornadoċash', 'CAѕH']);
    expect(result.detected).toStrictEqual(true);
  });

  it('Tornado\\u{17B4}Cash\\u{1D17A} (CA\\u{2003}SH) impersonates Tornado Cash (CASH)', async () => {
    await run(['Tornado Cash', 'CASH'], ['Tornado\u{17B4}Cash\u{1D17A}', 'CA\u{2003}SH']);
    expect(result.detected).toStrictEqual(true);
  });
});
