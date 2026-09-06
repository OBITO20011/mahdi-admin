import {
  runIncidentCycle,
  sendTelegramMessage,
} from './developer-alert-core.mjs';

const botToken = process.env.DEV_TELEGRAM_BOT_TOKEN
  || process.env.NAWASRAH_DEV_TELEGRAM_BOT_TOKEN;
const chatId = process.env.DEV_TELEGRAM_CHAT_ID
  || process.env.NAWASRAH_DEV_TELEGRAM_CHAT_ID;
const send = ({message}) => sendTelegramMessage({botToken, chatId, message});
const incident = {
  key: 'developer:test:failure-recovery',
  source: 'Developer Monitoring Self-Test',
  severity: 'low',
  healthy: false,
  summary: 'اختبار آمن لمحاكاة فشل تقني.',
  observedAt: '2026-09-07T00:00:00.000Z',
};

const first = await runIncidentCycle({
  checks: [incident],
  state: {version: 1, incidents: {}},
  send,
  now: new Date('2026-09-07T00:00:00.000Z'),
});
const duplicate = await runIncidentCycle({
  checks: [incident],
  state: first.state,
  send,
  now: new Date('2026-09-07T00:05:00.000Z'),
});
const recovery = await runIncidentCycle({
  checks: [{...incident, healthy: true, summary: 'اكتمل اختبار التعافي الآمن.'}],
  state: duplicate.state,
  send,
  now: new Date('2026-09-07T00:10:00.000Z'),
});

const result = {
  ok: first.notifications.length === 1
    && first.notifications[0].kind === 'incident'
    && first.notifications[0].delivered === true
    && duplicate.notifications.length === 0
    && recovery.notifications.length === 1
    && recovery.notifications[0].kind === 'recovery'
    && recovery.notifications[0].delivered === true,
  incidentNotifications: first.notifications.length,
  duplicateNotifications: duplicate.notifications.length,
  recoveryNotifications: recovery.notifications.length,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) process.exitCode = 1;
