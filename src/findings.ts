import { difference, maxBy } from 'lodash';
import { EntityType, Finding, FindingSeverity, FindingType, Label } from 'forta-agent';

import { Token } from './types';
import { AnalysisContext } from './analyzer/types';
import ObservationTimeModule from './analyzer/modules/observation-time';
import TokenImpersonation, {
  TokenImpersonationModuleMetadata,
} from './analyzer/modules/token-impersonation';
import AirdropModule, { AirdropModuleShortMetadata } from './analyzer/modules/airdrop';
import PhishingMetadataModule, {
  PhishingModuleMetadata,
} from './analyzer/modules/phishing-metadata';
import HighActivityModule, {
  HighActivityModuleShortMetadata,
} from './analyzer/modules/high-activity';
import SilentMint from './analyzer/modules/silent-mint';
import { parseLocation } from './utils/helpers';

const BASE_SPAM_ALERT_ID = 'SPAM-TOKEN';
const NEW_SPAM_ALERT_ID = `${BASE_SPAM_ALERT_ID}-NEW`;
const UPDATE_SPAM_ALERT_ID = `${BASE_SPAM_ALERT_ID}-UPDATE`;
const REMOVE_SPAM_ALERT_ID = `${BASE_SPAM_ALERT_ID}-REMOVE`;

const BASE_PHISHING_ALERT_ID = 'PHISHING-TOKEN';
const NEW_PHISHING_ALERT_ID = `${BASE_PHISHING_ALERT_ID}-NEW`;
const REMOVE_PHISHING_ALERT_ID = `${BASE_PHISHING_ALERT_ID}-REMOVE`;

const formatSpamToken = (address: string, analysis: AnalysisContext) => {
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

export function getIndicators(analysis: AnalysisContext): string[] {
  return Object.entries(analysis)
    .filter((e) => e[1].detected && e[0] !== ObservationTimeModule.Key)
    .map((e) => e[0]);
}

export function calcConfidence(analysis: AnalysisContext): number {
  const indicators = getIndicators(analysis).filter(
    (m) => m !== SilentMint.Key && m !== AirdropModule.Key,
  );

  let confidence = 0.55;

  if (indicators.length > 2) {
    confidence += 0.35;
  } else if (indicators.length > 1) {
    confidence += 0.15;
  }

  const receivers =
    (analysis[AirdropModule.Key]?.metadata as AirdropModuleShortMetadata)?.receiverCount ?? 0;

  if (receivers >= 1000) {
    confidence *= 1.2;
  } else if (receivers >= 100) {
    confidence *= 1.1;
  }

  const phishingMetadata = analysis[PhishingMetadataModule.Key]?.metadata as
    | PhishingModuleMetadata
    | undefined;

  const description: string =
    maxBy(Object.values(phishingMetadata?.descriptionByTokenId || {}), (e) => e.length) || '';

  // Too much for phishing?
  if (description.length >= 2000) {
    confidence *= 0.8;
  }

  const urls = phishingMetadata?.urls || [];
  if (urls.length > 1) {
    // Get unique hostnames
    const hosts = new Set(urls.map((url) => parseLocation(url)?.host).filter((v) => v));

    // The more unique domains there are, the less likely it is to be phishing
    const multiplier = Math.max(0.15, 0.8 / (hosts.size - 1));

    confidence *= multiplier;
  }

  const senders: number =
    (analysis[HighActivityModule.Key]?.metadata as HighActivityModuleShortMetadata)?.senderCount ||
    0;

  if (senders >= 300) {
    confidence *= 0.8;
  }

  return Math.min(1, confidence);
}

export function getLabels(token: Token, analysis: AnalysisContext, remove: boolean = false) {
  const confidence = calcConfidence(analysis);
  const indicators = getIndicators(analysis);

  return [
    Label.fromObject({
      label: 'Spam Token',
      entity: token.address,
      remove: remove,
      entityType: EntityType.Address,
      confidence: confidence,
      metadata: {
        indicators: JSON.stringify(indicators),
      },
    }),
    Label.fromObject({
      label: 'Spammer',
      entity: token.deployer,
      remove: remove,
      entityType: EntityType.Address,
      confidence: confidence,
      metadata: {
        indicators: JSON.stringify(indicators),
      },
    }),
  ];
}

export function createSpamNewFinding(token: Token, analysis: AnalysisContext) {
  const confidence = calcConfidence(analysis);
  const labels = getLabels(token, analysis, false);

  return Finding.from({
    alertId: NEW_SPAM_ALERT_ID,
    name: 'Spam Token',
    description:
      `The ERC-${token.type} token ${formatSpamToken(token.address, analysis)} ` +
      `shows signs of spam token behavior. Indicators: ${formatTriggeredModules(analysis)}.`,
    type: FindingType.Suspicious,
    severity: FindingSeverity.Low,
    labels: labels,
    addresses: [token.address, token.deployer],
    metadata: {
      confidence: confidence.toString(),
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

  const confidence = calcConfidence(currAnalysis);
  const labels = getLabels(token, currAnalysis, false);

  return Finding.from({
    alertId: UPDATE_SPAM_ALERT_ID,
    name: 'Spam Token (Update)',
    description:
      `The ERC-${token.type} token ${formatSpamToken(token.address, currAnalysis)} ` +
      `shows signs of spam token behavior. ` +
      `Indicators: ${formatTriggeredModules(currAnalysis)}.` +
      (addedModules.length > 0 ? ` New: ${addedModules.join(', ')}.` : '') +
      (removedModules.length > 0 ? ` Removed: ${removedModules.join(', ')}.` : ''),
    type: FindingType.Suspicious,
    severity: FindingSeverity.Low,
    labels: labels,
    addresses: [token.address, token.deployer],
    metadata: {
      confidence: confidence.toString(),
      tokenAddress: token.address,
      tokenStandard: `ERC-${token.type}`,
      tokenDeployer: token.deployer,
      analysis: JSON.stringify(currAnalysis),
    },
  });
}

export function createSpamRemoveFinding(token: Token, currAnalysis: AnalysisContext) {
  const labels = getLabels(token, currAnalysis, true);

  return Finding.from({
    alertId: REMOVE_SPAM_ALERT_ID,
    name: 'Spam Token (Remove)',
    description:
      `The ERC-${token.type} token ${formatSpamToken(token.address, currAnalysis)} ` +
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

function formatPhishingToken(address: string, metadata: PhishingModuleMetadata) {
  const name = metadata?.name;
  const symbol = metadata?.symbol;

  return [name && name, symbol && `(${symbol})`, address].filter((v) => v).join(' ');
}

function getPhishingLabels(
  token: Token,
  urls: string[],
  confidence: number,
  remove: boolean,
): Label[] {
  return [
    {
      label: 'Phishing Token',
      entityType: EntityType.Address,
      entity: token.address,
      confidence: confidence,
      remove: false,
      metadata: {
        deployer: token.deployer,
      },
    },
    {
      label: 'Scammer',
      entityType: EntityType.Address,
      entity: token.deployer,
      confidence: confidence,
      remove: remove,
      metadata: {
        urls: JSON.stringify(urls),
        token: token.address,
      },
    },
    ...urls.map((url) => ({
      label: 'Phishing URL',
      entityType: EntityType.Url,
      entity: url,
      confidence: confidence,
      remove: remove,
      metadata: {
        token: token.address,
        deployer: token.deployer,
      },
    })),
  ];
}

export function createPhishingNewFinding(token: Token, analysis: AnalysisContext) {
  const metadata = (analysis[PhishingMetadataModule.Key] || {}) as PhishingModuleMetadata;
  const confidence = calcConfidence(analysis);

  const labels = getPhishingLabels(token, metadata.urls || [], confidence, false);

  return Finding.from({
    alertId: NEW_PHISHING_ALERT_ID,
    name: 'Phishing Token',
    description:
      `The ERC-${token.type} token ${formatPhishingToken(token.address, metadata)} ` +
      `shows signs of phishing behavior. Potential phishing urls: ${metadata.urls?.join(', ')}`,
    type: FindingType.Suspicious,
    severity: FindingSeverity.Low,
    labels: labels,
    addresses: [token.address, token.deployer],
    metadata: {
      confidence: confidence.toString(),
      tokenAddress: token.address,
      tokenStandard: `ERC-${token.type}`,
      tokenDeployer: token.deployer,
      urls: JSON.stringify(metadata.urls || []),
      analysis: JSON.stringify(metadata),
    },
  });
}

export function createPhishingRemoveFinding(token: Token, analysis: AnalysisContext = {}) {
  const metadata = analysis[PhishingMetadataModule.Key]?.metadata as
    | PhishingModuleMetadata
    | undefined;

  const urls = metadata?.urls || [];
  const labels = getPhishingLabels(token, urls, 0, true);

  return Finding.from({
    alertId: REMOVE_PHISHING_ALERT_ID,
    name: 'Phishing Token (Remove)',
    description:
      `The ERC-${token.type} token ${token.address} ` +
      `no longer shows signs of phishing token behaviour.`,
    type: FindingType.Info,
    severity: FindingSeverity.Info,
    labels: labels,
    addresses: [token.address, token.deployer],
    metadata: {
      tokenAddress: token.address,
      tokenStandard: `ERC-${token.type}`,
      tokenDeployer: token.deployer,
      urls: JSON.stringify(urls),
    },
  });
}
