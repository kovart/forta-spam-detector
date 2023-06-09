import { difference } from 'lodash';
import { EntityType, Finding, FindingSeverity, FindingType, Label } from 'forta-agent';

import { Token } from './types';
import { AnalysisContext } from './analyzer/types';
import ObservationTimeModule from './analyzer/modules/observation-time';
import TokenImpersonation, {
  TokenImpersonationModuleMetadata,
} from './analyzer/modules/token-impersonation';

const BASE_ALERT_ID = 'SPAM-TOKEN';
const NEW_ALERT_ID = `${BASE_ALERT_ID}-NEW`;
const UPDATE_ALERT_ID = `${BASE_ALERT_ID}-UPDATE`;
const REMOVE_ALERT_ID = `${BASE_ALERT_ID}-REMOVE`;

const formatToken = (address: string, analysis: AnalysisContext) => {
  const tokenImpersonationMetadata = analysis[TokenImpersonation.Key]
    ?.metadata as TokenImpersonationModuleMetadata;
  const name = tokenImpersonationMetadata?.name;
  const symbol = tokenImpersonationMetadata?.symbol;

  return [name && name, symbol && `(${symbol})`, address].filter((v) => v).join(' ');
};

const formatTriggeredModules = (analysis: AnalysisContext) => {
  const modules = Object.entries(analysis)
    .filter((e) => e[1].detected && e[0] !== ObservationTimeModule.Key)
    .map((e) => e[0]);

  return modules.join(', ');
};

export function createSpamNewFinding(token: Token, analysis: AnalysisContext) {
  const labels = [
    Label.fromObject({
      label: 'Spam',
      entity: token.address,
      remove: false,
      entityType: EntityType.Address,
      confidence: 0.7,
    }),
    Label.fromObject({
      label: 'Spammer',
      entity: token.deployer,
      remove: false,
      entityType: EntityType.Address,
      confidence: 0.7,
    }),
  ];

  return Finding.from({
    alertId: NEW_ALERT_ID,
    name: 'Spam Token',
    description:
      `The ERC-${token.type} token ${formatToken(token.address, analysis)} ` +
      `shows signs of spam token behavior. Indicators: ${formatTriggeredModules(analysis)}.`,
    type: FindingType.Suspicious,
    severity: FindingSeverity.Low,
    labels: labels,
    addresses: [token.address, token.deployer],
    metadata: {
      tokenAddress: token.address,
      tokenStandard: `ERC-${token.type}`,
      tokenDeployer: token.deployer,
      analysis: JSON.stringify(analysis),
    },
  });
}

export function createSpamUpdateFinding(
  token: Token,
  currAnalysis: AnalysisContext,
  prevAnalysis: AnalysisContext,
) {
  const currModules = Object.entries(currAnalysis)
    .filter((e) => e[1].detected)
    .map((e) => e[0]);
  const prevModules = Object.entries(prevAnalysis)
    .filter((e) => e[1].detected)
    .map((e) => e[0]);

  const diff = difference(currModules, prevModules);

  const addedModules = diff.filter((m) => !prevModules.includes(m));
  const removedModules = diff.filter((m) => !currModules.includes(m));

  return Finding.from({
    alertId: UPDATE_ALERT_ID,
    name: 'Spam Token (Update)',
    description:
      `The ERC-${token.type} token ${formatToken(token.address, currAnalysis)} ` +
      `shows signs of spam token behavior. ` +
      `Indicators: ${formatTriggeredModules(currAnalysis)}.` +
      (addedModules.length > 0 ? ` New: ${addedModules.join(', ')}.` : '') +
      (removedModules.length > 0 ? ` Removed: ${removedModules.join(', ')}.` : ''),
    type: FindingType.Suspicious,
    severity: FindingSeverity.Low,
    labels: [],
    addresses: [],
    metadata: {
      tokenAddress: token.address,
      tokenStandard: `ERC-${token.type}`,
      tokenDeployer: token.deployer,
      analysis: JSON.stringify(currAnalysis),
    },
  });
}

export function createSpamRemoveFinding(token: Token, currAnalysis: AnalysisContext) {
  const labels = [
    Label.fromObject({
      label: 'Spam',
      entity: token.address,
      remove: true,
      entityType: EntityType.Address,
      confidence: 0.7,
    }),
    Label.fromObject({
      label: 'Spammer',
      entity: token.deployer,
      remove: true,
      entityType: EntityType.Address,
      confidence: 0.7,
    }),
  ];

  return Finding.from({
    alertId: REMOVE_ALERT_ID,
    name: 'Spam Token (Remove)',
    description:
      `The ERC-${token.type} token ${formatToken(token.address, currAnalysis)} ` +
      `no longer shows signs of spam token behavior.`,
    type: FindingType.Info,
    severity: FindingSeverity.Info,
    labels: labels,
    addresses: [token.address, token.deployer],
    metadata: {
      tokenAddress: token.address,
      tokenStandard: `ERC-${token.type}`,
      tokenDeployer: token.deployer,
      analysis: JSON.stringify(currAnalysis),
    },
  });
}
