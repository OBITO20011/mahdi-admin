import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const compose = readFileSync('automation/n8n/compose.yaml', 'utf8');
const setup = readFileSync('automation/n8n/setup.ps1', 'utf8');
const docs = readFileSync('automation/n8n/README.md', 'utf8');
const backup = readFileSync('automation/n8n/backup.ps1', 'utf8');
const backupEncryption = readFileSync('automation/n8n/encrypt-backup.mjs', 'utf8');
const feedCredentialImport = readFileSync(
  'automation/n8n/import-feed-credential.ps1',
  'utf8',
);
const alertWorkflows = readFileSync(
  'automation/n8n/workflows/nawasrah-alerts.json',
  'utf8',
);
const workflowImport = readFileSync(
  'automation/n8n/import-workflows.ps1',
  'utf8',
);
const workflowRefresh = readFileSync(
  'automation/n8n/refresh-live-alert-workflows.ps1',
  'utf8',
);

type AlertWorkflow = {
  name: string;
  nodes: Array<{
    id: string;
    parameters: { text?: string; textBody?: string };
  }>;
};

const parsedAlertWorkflows = JSON.parse(alertWorkflows) as AlertWorkflow[];

test('n8n is local-only, persistent, encrypted and resource bounded', () => {
  assert.match(compose, /127\.0\.0\.1:\$\{N8N_PORT/);
  assert.match(compose, /N8N_ENCRYPTION_KEY/);
  assert.match(compose, /n8n_data:\/home\/node\/\.n8n/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:[\s\S]*- ALL/);
  assert.match(compose, /mem_limit: 1g/);
  assert.match(compose, /EXECUTIONS_DATA_PRUNE: "true"/);
  assert.doesNotMatch(compose, /^\s*init:\s*true\s*$/m);
});

test('n8n setup generates the secret locally without embedding production credentials', () => {
  assert.match(setup, /RandomNumberGenerator/);
  assert.match(setup, /Protect-EnvironmentFile/);
  assert.match(setup, /NAWASRAH_AUTOMATION_SECRET/);
  assert.match(setup, /\.env\.feed/);
  assert.match(setup, /\.env\.channels/);
  assert.match(setup, /NAWASRAH_TELEGRAM_CHAT_ID/);
  assert.match(setup, /NAWASRAH_WHATSAPP_RECIPIENT/);
  assert.doesNotMatch(compose + setup + docs, /service_role\s*[=:]\s*[A-Za-z0-9._-]+/i);
  assert.doesNotMatch(compose + setup, /SUPABASE_(?:KEY|PASSWORD|SERVICE_ROLE)/i);
});

test('n8n cannot bypass canonical ERP inventory or accounting functions', () => {
  assert.match(docs, /must never update ERP tables directly/i);
  assert.match(docs, /Do not place the Supabase `service_role` key in n8n/);
  assert.match(compose, /n8n-nodes-base\.executeCommand/);
  assert.match(compose, /n8n-nodes-base\.readWriteFile/);
  assert.match(compose, /n8n-nodes-base\.code/);
  assert.match(compose, /N8N_PYTHON_ENABLED:\s*["']false["']/);
  assert.match(compose, /N8N_COMMUNITY_PACKAGES_ENABLED:\s*["']false["']/);
  assert.match(compose, /N8N_UNVERIFIED_PACKAGES_ENABLED:\s*["']false["']/);
  assert.match(compose, /N8N_PUBLIC_API_DISABLED: "true"/);
});

test('n8n backup is complete, encrypted, and verified before publication', () => {
  assert.match(backup, /nawasrah_n8n_data:\/source\/n8n-data:ro/);
  assert.match(backup, /nawasrah_n8n_files:\/source\/n8n-files:ro/);
  assert.match(backup, /n8n\.env:ro/);
  assert.match(backup, /feed\.env:ro/);
  assert.match(backup, /channels\.env:ro/);
  assert.match(backup, /archivePassphrase/);
  assert.match(backup, /\.partial/);
  assert.match(backupEncryption, /encryptFile/);
  assert.match(backupEncryption, /decryptFile/);
  assert.match(backupEncryption, /sourceHash !== verifiedHash/);
});

test('the Supabase feed secret is imported as an encrypted n8n credential', () => {
  assert.match(feedCredentialImport, /httpHeaderAuth/);
  assert.match(feedCredentialImport, /x-nawasrah-automation-secret/);
  assert.match(feedCredentialImport, /import:credentials/);
  assert.match(feedCredentialImport, /export:credentials/);
  assert.doesNotMatch(feedCredentialImport, /--decrypted/);
  assert.match(feedCredentialImport, /Contains\(\$feedSecret\)/);
  assert.match(feedCredentialImport, /Remove-Item[\s\S]*temporaryRoot/);
});

test('Telegram and WhatsApp workflows use independent durable feed channels', () => {
  assert.match(alertWorkflows, /\\\"channel\\\":\\\"telegram\\\"/);
  assert.match(alertWorkflows, /\\\"channel\\\":\\\"whatsapp\\\"/);
  assert.match(alertWorkflows, /Complete Telegram Delivery/);
  assert.match(alertWorkflows, /Complete WhatsApp Delivery/);
  assert.match(alertWorkflows, /nawasrahFeedAuth/);
  assert.match(alertWorkflows, /\"active\": false/);
});

test('Telegram and WhatsApp message expressions compile before import', () => {
  for (const workflow of parsedAlertWorkflows) {
    const sendNode = workflow.nodes.find((node) => node.id.endsWith('-send'));
    const expression = sendNode?.parameters.text ?? sendNode?.parameters.textBody;

    assert.ok(expression, `${workflow.name} must define a message expression`);
    assert.match(expression, /^=\{\{[\s\S]+\}\}$/);
    let formatter: ($json: Record<string, unknown>) => unknown;
    assert.doesNotThrow(() => {
      const source = expression.slice(3, -3);
      formatter = new Function('$json', `return (${source})`) as (
        $json: Record<string, unknown>
      ) => unknown;
    });
    const message = String(
      formatter!({
        eventType: 'new_order',
        entityId: 'order-id',
        payload: {
          orderNumber: 'ORD-2026-001',
          customerName: 'أحمد',
          customerPhone: '0790000000',
          deliveryAddress: 'الرمثا - الحي الشرقي',
          deliveryZone: 'inside_ramtha',
          deliveryFeeInMinorUnits: 2000,
          totalInMinorUnits: 12000,
          paymentMethod: 'cash_on_delivery',
        },
      })
    );
    assert.match(message, /طلب جديد من موقع النواصرة/);
    assert.match(message, /كاش عند الاستلام/);
    assert.match(message, /12\.000 د\.أ/);
    assert.doesNotMatch(message, /\\u[0-9a-f]{4}/i);
  }
});

test('the temporary WhatsApp recipient is centralized and normalized', () => {
  assert.match(alertWorkflows, /WhatsApp - Central Recipient/);
  assert.match(alertWorkflows, /REPLACE_WITH_WHATSAPP_RECIPIENT/);
  assert.match(alertWorkflows, /REPLACE_WITH_TELEGRAM_CHAT_ID/);
  assert.match(workflowImport, /import:workflow/);
  assert.match(workflowImport, /Alert workflows must be imported inactive/);
  assert.match(workflowImport, /NAWASRAH_TELEGRAM_CHAT_ID/);
  assert.match(workflowImport, /NAWASRAH_WHATSAPP_RECIPIENT/);
  assert.match(workflowImport, /temporaryWorkflowPath/);
  assert.match(workflowImport, /Get-Content -LiteralPath \$workflowPath -Raw -Encoding UTF8/);
});

test('the live refresh protects active workflows while verifying UTF-8', () => {
  assert.match(workflowRefresh, /Get-Content -LiteralPath \$workflowPath -Raw -Encoding UTF8/);
  assert.match(workflowRefresh, /nodes\s+= \$liveWorkflow\.nodes/);
  assert.match(workflowRefresh, /active\s+= \[bool\]\$liveWorkflow\.active/);
  assert.match(workflowRefresh, /if \(\$liveWorkflow\.active\)/);
  assert.doesNotMatch(workflowRefresh, /--activeState=fromJson/);
  assert.match(workflowRefresh, /UTF-8 verification failed/);
});
