import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  formatDeveloperAlert,
  getWorkflowTransition,
  parseTechnicalJson,
  runIncidentCycle,
  sanitizeTechnicalDetails,
  sendTelegramMessage,
} from '../scripts/monitoring/developer-alert-core.mjs';

test('technical JSON accepts a Windows PowerShell UTF-8 BOM', () => {
  assert.deepEqual(parseTechnicalJson('\uFEFF{"result":"PASS"}'), {result: 'PASS'});
});

const failedCheck = {
  key: 'developer:n8n:healthz',
  source: 'n8n',
  severity: 'high',
  healthy: false,
  summary: 'n8n health endpoint is unavailable.',
  details: {httpStatus: 0},
  observedAt: '2026-09-06T10:00:00.000Z',
};

test('one incident is deduplicated and followed by one recovery', async () => {
  const deliveries: Array<{kind: string; eventKey: string}> = [];
  const send = async (item: {kind: string; eventKey: string}) => {
    deliveries.push(item);
    return true;
  };

  const first = await runIncidentCycle({
    checks: [failedCheck], state: {version: 1, incidents: {}}, send,
    now: new Date('2026-09-06T10:00:00.000Z'),
  });
  const duplicate = await runIncidentCycle({
    checks: [failedCheck], state: first.state, send,
    now: new Date('2026-09-06T10:05:00.000Z'),
  });
  const recovered = await runIncidentCycle({
    checks: [{...failedCheck, healthy: true, summary: 'n8n recovered.'}],
    state: duplicate.state, send,
    now: new Date('2026-09-06T10:10:00.000Z'),
  });
  const stillHealthy = await runIncidentCycle({
    checks: [{...failedCheck, healthy: true, summary: 'n8n recovered.'}],
    state: recovered.state, send,
    now: new Date('2026-09-06T10:15:00.000Z'),
  });

  assert.deepEqual(deliveries.map(({kind}) => kind), ['incident', 'recovery']);
  assert.equal(stillHealthy.notifications.length, 0);
  assert.equal(stillHealthy.state.incidents[failedCheck.key].active, false);
});

test('persistent incidents observe a severity cooldown before one reminder', async () => {
  let sends = 0;
  const send = async () => { sends += 1; return true; };
  const initial = await runIncidentCycle({
    checks: [failedCheck], state: {version: 1, incidents: {}}, send,
    now: new Date('2026-09-06T10:00:00.000Z'),
  });
  const beforeCooldown = await runIncidentCycle({
    checks: [failedCheck], state: initial.state, send,
    now: new Date('2026-09-06T10:59:00.000Z'),
  });
  const afterCooldown = await runIncidentCycle({
    checks: [failedCheck], state: beforeCooldown.state, send,
    now: new Date('2026-09-06T11:01:00.000Z'),
  });
  assert.equal(sends, 2);
  assert.equal(afterCooldown.notifications[0]?.kind, 'reminder');
});

test('failed delivery is retried on the next cycle and recovery is not fabricated', async () => {
  const first = await runIncidentCycle({
    checks: [failedCheck], state: {version: 1, incidents: {}}, send: async () => false,
    now: new Date('2026-09-06T10:00:00.000Z'),
  });
  assert.equal(first.state.incidents[failedCheck.key].lastNotifiedAt, null);
  const recovered = await runIncidentCycle({
    checks: [{...failedCheck, healthy: true}], state: first.state, send: async () => true,
    now: new Date('2026-09-06T10:05:00.000Z'),
  });
  assert.equal(recovered.notifications.length, 0);
  assert.equal(recovered.state.incidents[failedCheck.key].active, false);
});

test('technical payload sanitizer drops business and credential fields', () => {
  assert.deepEqual(
    sanitizeTechnicalDetails({
      status: 'failed', customerPhone: '0790000000', totalAmount: 25,
      authorization: 'Bearer secret', job: 'backup',
    }),
    {status: 'failed', job: 'backup'},
  );
  const message = formatDeveloperAlert({...failedCheck, details: {phone: '0790000000'}}, 'incident');
  assert.doesNotMatch(message, /0790000000/u);
});

test('Telegram transport has three bounded attempts and never needs n8n', async () => {
  let attempts = 0;
  const delivered = await sendTelegramMessage({
    botToken: 'test-token', chatId: '1234', message: 'test',
    fetchImpl: async () => {
      attempts += 1;
      return {ok: attempts === 3} as Response;
    },
  });
  assert.equal(delivered, true);
  assert.equal(attempts, 3);
});

test('live self-test has one incident, no duplicate, and one recovery', async () => {
  const selfTest = await readFile('scripts/monitoring/run-developer-alert-e2e.mjs', 'utf8');
  assert.match(selfTest, /DEV_TELEGRAM_BOT_TOKEN/u);
  assert.match(selfTest, /DEV_TELEGRAM_CHAT_ID/u);
  assert.match(selfTest, /duplicateNotifications/u);
  assert.match(selfTest, /duplicate\.notifications\.length === 0/u);
  assert.match(selfTest, /recoveryNotifications/u);
  assert.doesNotMatch(selfTest, /customer|order|amount|balance/iu);
});

test('watchdog is separate from Business outbox and uses read-only monitoring', async () => {
  const watchdog = await readFile('scripts/monitoring/run-developer-watchdog.mjs', 'utf8');
  const runner = await readFile('scripts/monitoring/run-developer-watchdog.ps1', 'utf8');
  assert.match(watchdog, /default_transaction_read_only=on/u);
  assert.match(watchdog, /automation_event_deliveries/u);
  assert.match(watchdog, /failureCount/u);
  assert.match(watchdog, /Cloudflare Pages/u);
  assert.match(watchdog, /deployment_trigger\?\.metadata\?\.commit_hash/u);
  assert.match(watchdog, /--probe-only/u);
  assert.match(watchdog, /10 \* 60_000/u);
  assert.match(watchdog, /recoveredStaleLock/u);
  assert.match(watchdog, /developer:backup:n8n/u);
  assert.match(watchdog, /Nawasrah n8n Daily Backup/u);
  assert.match(watchdog, /restoreVerified/u);
  assert.match(watchdog, /developer:automation:dead-letter/u);
  assert.match(watchdog, /developer:automation:stuck-lease/u);
  assert.match(watchdog, /developer:automation:latency/u);
  assert.match(watchdog, /developer:business-summary:schedule/u);
  assert.match(watchdog, /get_business_summary_monitoring_status/u);
  assert.match(watchdog, /summary_monitoring_installed/u);
  assert.match(watchdog, /Nawasrah Docker Safe Startup/u);
  assert.match(watchdog, /Nawasrah ERP Nightly Backup/u);
  assert.doesNotMatch(watchdog + runner, /SUPABASE_SERVICE_ROLE_KEY/u);
  assert.doesNotMatch(watchdog + runner, /claim_automation_deliveries|complete_automation_delivery/u);
  assert.doesNotMatch(watchdog + runner, /customer_name|customer_phone|delivery_address|total_in_minor_units/iu);
  assert.doesNotMatch(watchdog, /grossSalesInMinorUnits|customerDueInMinorUnits|supplierDueInMinorUnits/u);
});

test('Windows setup protects dedicated secrets and schedules one bounded SYSTEM watchdog', async () => {
  const setup = await readFile('scripts/monitoring/setup-developer-monitoring.ps1', 'utf8');
  const localActivation = await readFile('scripts/monitoring/activate-developer-monitoring-local.mjs', 'utf8');
  const register = await readFile('scripts/monitoring/register-developer-watchdog.ps1', 'utf8');
  assert.match(setup, /Read-Host 'Developer Telegram Bot Token' -AsSecureString/u);
  assert.match(setup, /DataProtectionScope\]::LocalMachine/u);
  assert.match(setup, /Set-RestrictedConfigAcl/u);
  assert.match(setup, /Cloudflare API Token \(Pages read-only\)/u);
  assert.match(setup, /WindowsBuiltInRole\]::Administrator/u);
  assert.match(setup, /test-system-dpapi\.ps1/u);
  assert.match(setup, /CredentialEnvelopePath/u);
  assert.match(setup, /Unprotect-MachineValue/u);
  assert.match(setup, /Remove-Item -LiteralPath \$resolvedEnvelopePath/u);
  assert.match(setup, /NT AUTHORITY\\SYSTEM/u);
  assert.doesNotMatch(setup, /NAWASRAH_TELEGRAM_CHAT_ID/u);
  assert.match(register, /-UserId 'SYSTEM'/u);
  assert.match(register, /-RepetitionInterval \(New-TimeSpan -Minutes 5\)/u);
  assert.match(register, /-MultipleInstances IgnoreNew/u);
  assert.match(register, /-ExecutionTimeLimit \(New-TimeSpan -Minutes 4\)/u);
  assert.match(register, /Unregister-ScheduledTask -TaskName \$TaskName/u);
  assert.doesNotMatch(register, /RestartCount/u);
  assert.match(localActivation, /listen\(0, '127\.0\.0\.1'/u);
  assert.match(localActivation, /DataProtectionScope\]::LocalMachine/u);
  assert.match(localActivation, /Cache-Control', 'no-store'/u);
  assert.doesNotMatch(localActivation, /console\.(?:log|error)\([^\n]*(?:telegramToken|cloudflareToken)/u);
});

test('machine-scope DPAPI has a bounded SYSTEM interoperability probe with no secret output', async () => {
  const probe = await readFile('scripts/monitoring/test-system-dpapi.ps1', 'utf8');
  const worker = await readFile('scripts/monitoring/system-dpapi-probe-worker.ps1', 'utf8');
  assert.match(probe, /DataProtectionScope\]::LocalMachine/u);
  assert.match(probe, /-UserId 'SYSTEM'/u);
  assert.match(probe, /AddSeconds\(60\)/u);
  assert.match(probe, /Remove-Item -LiteralPath \$probeRoot -Recurse -Force/u);
  assert.match(worker, /DataProtectionScope\]::LocalMachine/u);
  assert.match(worker, /SHA256\]::Create/u);
  assert.match(worker, /StringComparison\]::Ordinal/u);
  assert.doesNotMatch(worker, /Write-(?:Host|Output).*plain/iu);
});

test('monitoring status exposes incidents but never developer credentials', async () => {
  const status = await readFile('scripts/monitoring/get-developer-monitoring-status.ps1', 'utf8');
  assert.match(status, /activeIncidents/u);
  assert.match(status, /lastTaskResult/u);
  assert.doesNotMatch(status, /telegramBotToken|cloudflareApiToken|databasePassword|archivePassphrase/u);
});

test('GitHub failures and recoveries use the dedicated developer workflow only', async () => {
  const workflow = await readFile('.github/workflows/developer-alerts.yml', 'utf8');
  const sender = await readFile('scripts/monitoring/github-workflow-alert.mjs', 'utf8');
  assert.match(workflow, /Nawasrah code quality/u);
  assert.match(workflow, /Nawasrah secret scanning/u);
  assert.match(workflow, /Nawasrah public uptime/u);
  assert.match(workflow, /DEVELOPER_ALERTS_ENABLED/u);
  assert.match(workflow, /DEV_TELEGRAM_BOT_TOKEN/u);
  assert.match(workflow, /workflow_dispatch/u);
  assert.match(workflow, /run-developer-alert-e2e\.mjs/u);
  assert.match(sender, /getWorkflowTransition/u);
  assert.doesNotMatch(workflow + sender, /NAWASRAH_TELEGRAM_CHAT_ID|nawasrahTelegramAlerts/u);
  assert.equal(getWorkflowTransition('failure', 'success'), 'incident');
  assert.equal(getWorkflowTransition('failure', 'failure'), null);
  assert.equal(getWorkflowTransition('success', 'failure'), 'recovery');
  assert.equal(getWorkflowTransition('success', 'success'), null);
});
