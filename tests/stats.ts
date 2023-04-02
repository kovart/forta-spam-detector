import { TokenTestResult } from './test';
import { getTestResultStorage } from './utils/storages';
import { formatDuration } from './helpers';
import { TokenStandard } from '../src/types';

function log(title: string, tokens: TokenTestResult[]) {
  let truePositives: number = 0;
  let trueNegatives: number = 0;
  let falsePositives: number = 0;
  let falseNegatives: number = 0;

  let spamDetectionTimeList: number[] = [];
  let assessmentChangeTimeList: number[] = [];
  for (const token of tokens) {
    if (token.isSpam && token.isSpamDetected) truePositives++;
    else if (token.isSpam && !token.isSpamDetected) falseNegatives++;
    else if (!token.isSpam && token.isSpamDetected) falsePositives++;
    else if (!token.isSpam && !token.isSpamDetected) trueNegatives++;

    if (token.isSpam && token.spamDetectedAt > 0) {
      spamDetectionTimeList.push(token.spamDetectedAt - token.deployedAt);
    }

    if (token.spamAssessmentChangedAt > 0) {
      assessmentChangeTimeList.push(token.spamAssessmentChangedAt - token.spamDetectedAt);
    }
  }

  const spamTokens = tokens.filter((t) => t.isSpam);
  const nonSpamTokens = tokens.filter((t) => !t.isSpam);

  console.log(
    [
      `${title}: ${spamTokens.length} Spam + ${nonSpamTokens.length} Good = ${tokens.length} tokens`,
      `------------------------`,
      `True Positives: ${truePositives}`,
      `True Negatives: ${trueNegatives}`,
      `False Positives: ${falsePositives}`,
      `False Negatives: ${falseNegatives}`,
      `------------------------`,
      `Average Spam Detection Time: ${formatDuration(
        spamDetectionTimeList.reduce((acc, curr) => acc + curr, 0) / spamDetectionTimeList.length,
      )}`,
      `Average Assessment Change Time (Spam -> Not Spam): ${formatDuration(
        assessmentChangeTimeList.reduce((acc, curr) => acc + curr, 0) /
          assessmentChangeTimeList.length,
      )}`,
    ].join('\n'),
  );
  console.log('');
}

async function main() {
  const results = await getTestResultStorage(1).read();

  if (results.length > 0) {
    log('Summary', results);
    log(
      'ERC20',
      results.filter((r) => r.type === TokenStandard.Erc20),
    );
    log(
      'ERC721',
      results.filter((r) => r.type === TokenStandard.Erc721),
    );
    log(
      'ERC1155',
      results.filter((r) => r.type === TokenStandard.Erc1155),
    );
  }
}

main().catch((e) => {
  console.error(e);
  return 1;
});
