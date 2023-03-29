import { Finding, FindingSeverity, FindingType } from 'forta-agent';

import { TokenContract } from './types';

import { AnalysisContext } from './analyzer/types';

const BASE_ALERT_ID = 'AK-TOKEN-SPAM-BOT';
const NEW_ALERT_ID = `${BASE_ALERT_ID}-NEW`;
const UPDATE_ALERT_ID = `${BASE_ALERT_ID}-UPDATE`;
const REMOVE_ALERT_ID = `${BASE_ALERT_ID}-REMOVE`;

// TODO Simplify analysis

export function createSpamNewFinding(token: TokenContract, analysis: AnalysisContext) {
  return Finding.from({
    alertId: NEW_ALERT_ID,
    name: 'Token Spam',
    description: '',
    type: FindingType.Suspicious,
    severity: FindingSeverity.Low,
    labels: [],
    addresses: [token.address, token.deployer],
    metadata: {
      tokenAddress: token.address,
      tokenStandard: `ERC${token.type}`,
      tokenDeployerAddress: token.deployer,
      analysis: JSON.stringify(analysis),
    },
  });
}

export function createSpamUpdateFinding(
  token: TokenContract,
  currAnalysis: AnalysisContext,
  prevAnalysis: AnalysisContext,
) {
  // TODO show difference

  return Finding.from({
    alertId: UPDATE_ALERT_ID,
    name: 'Token Spam',
    description: '',
    type: FindingType.Suspicious,
    severity: FindingSeverity.Low,
    labels: [],
    addresses: [token.address, token.deployer],
    metadata: {
      tokenAddress: token.address,
      tokenStandard: `ERC${token.type}`,
      tokenDeployerAddress: token.deployer,
      analysis: JSON.stringify(currAnalysis),
    },
  });
}

export function createSpamRemoveFinding(token: TokenContract, currAnalysis: AnalysisContext) {
  // TODO show difference

  return Finding.from({
    alertId: REMOVE_ALERT_ID,
    name: 'Token Spam',
    description: '',
    type: FindingType.Info,
    severity: FindingSeverity.Info,
    labels: [],
    addresses: [token.address, token.deployer],
    metadata: {
      tokenAddress: token.address,
      tokenStandard: `ERC${token.type}`,
      tokenDeployerAddress: token.deployer,
      analysis: JSON.stringify(currAnalysis),
    },
  });
}
