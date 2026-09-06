import {getWorkflowTransition, sendTelegramMessage, sanitizeTechnicalText} from './developer-alert-core.mjs';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required developer monitoring setting: ${name}`);
  return value;
};

const workflowName = sanitizeTechnicalText(required('WATCHED_WORKFLOW_NAME'), 120);
const workflowId = required('WATCHED_WORKFLOW_ID');
const currentRunId = required('WATCHED_RUN_ID');
const currentConclusion = required('WATCHED_CONCLUSION');
const repository = required('GITHUB_REPOSITORY');
const githubToken = required('GITHUB_TOKEN');
const headSha = sanitizeTechnicalText(required('WATCHED_HEAD_SHA'), 40);
const runUrl = sanitizeTechnicalText(required('WATCHED_RUN_URL'), 300);

const response = await fetch(
  `https://api.github.com/repos/${repository}/actions/workflows/${workflowId}/runs?branch=main&status=completed&per_page=10`,
  {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${githubToken}`,
      'user-agent': 'nawasrah-developer-alerts',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  },
);
if (!response.ok) throw new Error('Unable to read prior GitHub workflow state.');
const history = await response.json();
const previous = history.workflow_runs?.find((run) => String(run.id) !== currentRunId);
const kind = getWorkflowTransition(currentConclusion, previous?.conclusion);

if (!kind) {
  process.stdout.write('No GitHub workflow incident transition to deliver.\n');
  process.exit(0);
}

const severity = workflowName.includes('secret scanning') ? 'CRITICAL' : 'HIGH';
const message = [
  kind === 'recovery' ? '✅ تعافي GitHub workflow' : '🚨 فشل GitHub workflow',
  `المصدر: ${workflowName}`,
  `الخطورة: ${severity}`,
  `الحالة: ${currentConclusion}`,
  `SHA: ${headSha.slice(0, 12)}`,
  `التفاصيل: ${runUrl}`,
  `Event key: developer:github:${workflowId}`,
].join('\n');

const delivered = await sendTelegramMessage({
  botToken: required('DEV_TELEGRAM_BOT_TOKEN'),
  chatId: required('DEV_TELEGRAM_CHAT_ID'),
  message,
});
if (!delivered) throw new Error('Developer Telegram delivery failed after bounded retries.');
process.stdout.write(`Developer ${kind} notification delivered for ${workflowName}.\n`);
