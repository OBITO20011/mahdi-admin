import {spawnSync} from 'node:child_process';
import {readFile, rename, writeFile, mkdir, open, unlink, stat} from 'node:fs/promises';
import path from 'node:path';
import {parseTechnicalJson, runIncidentCycle, sendTelegramMessage} from './developer-alert-core.mjs';

const root = process.env.NAWASRAH_DEVELOPER_MONITOR_ROOT || 'C:\\ProgramData\\NawasrahDeveloperMonitoring';
const statePath = path.join(root, 'incidents.json');
const lockPath = path.join(root, 'watchdog.lock');
const now = new Date();
const probeOnly = process.argv.includes('--probe-only');

const readJson = async (filePath) => parseTechnicalJson(await readFile(filePath, 'utf8'));
const ageHours = (value) => (now.getTime() - Date.parse(value)) / 3_600_000;
const check = (key, source, severity, healthy, summary, details = {}) => ({
  key, source, severity, healthy, summary, details, observedAt: now.toISOString(),
});

function run(command, args, timeout = 15_000, environment = process.env) {
  const result = spawnSync(command, args, {encoding: 'utf8', windowsHide: true, timeout, env: environment});
  return {ok: !result.error && result.status === 0, stdout: result.stdout?.trim() || '', stderr: result.stderr?.trim() || ''};
}

function runMonitoringSql(sql, timeout = 30_000) {
  const psql = process.env.NAWASRAH_PSQL_PATH;
  const databaseUrl = process.env.NAWASRAH_SUPABASE_DATABASE_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!psql || !databaseUrl || !password) return {ok: false, stdout: '', stderr: 'configuration unavailable'};
  return run(psql, [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], timeout, {
    ...process.env,
    PGPASSWORD: password,
  });
}

async function collectLocalChecks() {
  const checks = [];
  try {
    const startup = await readJson(process.env.NAWASRAH_DOCKER_STATUS_PATH || 'C:\\ProgramData\\NawasrahDockerRecovery\\last-status.json');
    checks.push(check('developer:docker:safe-startup', 'Docker Safe Startup', 'high', startup.result === 'PASS', startup.result === 'PASS' ? 'آخر تشغيل آمن لـDocker نجح.' : 'فشل تشغيل Docker الآمن.', {stage: startup.stage || 'unknown'}));
  } catch {
    checks.push(check('developer:docker:safe-startup', 'Docker Safe Startup', 'high', false, 'ملف حالة Docker Safe Startup غير متاح.'));
  }
  const task = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$i=Get-ScheduledTaskInfo -TaskName 'Nawasrah Docker Safe Startup' -ErrorAction Stop; [string]$i.LastTaskResult"]);
  const taskResult = Number(task.stdout);
  checks.push(check('developer:docker:safe-startup-task', 'Windows Task Scheduler', 'high', task.ok && taskResult === 0, task.ok && taskResult === 0 ? 'مهمة Docker Safe Startup انتهت بنجاح.' : 'مهمة Docker Safe Startup فشلت أو غير متاحة.', {lastTaskResult: Number.isFinite(taskResult) ? taskResult : 'unavailable'}));

  const docker = run('docker.exe', ['inspect', '--format', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', 'nawasrah-n8n']);
  const [containerStatus, containerHealth] = docker.stdout.split('|');
  const containerHealthy = docker.ok && containerStatus === 'running' && containerHealth === 'healthy';
  checks.push(check('developer:n8n:container', 'n8n', 'high', containerHealthy, containerHealthy ? 'حاوية n8n تعمل وبحالة healthy.' : 'حاوية n8n متوقفة أو غير healthy.', {status: containerStatus || 'unavailable', health: containerHealth || 'unavailable'}));

  let healthStatus;
  try {
    const response = await fetch('http://127.0.0.1:5678/healthz', {signal: AbortSignal.timeout(10_000)});
    healthStatus = response.status;
  } catch {
    healthStatus = 0;
  }
  checks.push(check('developer:n8n:healthz', 'n8n', 'high', healthStatus === 200, healthStatus === 200 ? 'n8n health endpoint يستجيب.' : 'n8n health endpoint لا يستجيب.', {httpStatus: healthStatus || 'unreachable'}));

  if (docker.ok) {
    const logs = run('docker.exe', ['logs', '--since', '10m', 'nawasrah-n8n'], 20_000);
    const logText = `${logs.stdout}\n${logs.stderr}`;
    const failureCount = (logText.match(/The connection cannot be established|Workflow execution (?:failed|error)|NodeOperationError/giu) || []).length;
    checks.push(check('developer:n8n:workflow-executions', 'n8n', 'medium', logs.ok && failureCount === 0, failureCount === 0 ? 'لا توجد أخطاء workflow حديثة.' : 'ظهرت أخطاء حديثة في تنفيذ n8n workflows.', {failureCount}));
  }

  return checks;
}

async function collectBackupChecks() {
  const checks = [];
  const backupRoot = process.env.NAWASRAH_BACKUP_ROOT;
  if (!backupRoot) return [check('developer:backup:configuration', 'Backup', 'critical', false, 'مسار النسخ الاحتياطية غير متاح للـwatchdog.')];
  const tasks = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$a=Get-ScheduledTaskInfo -TaskName 'Nawasrah ERP Nightly Backup' -ErrorAction Stop; $b=Get-ScheduledTaskInfo -TaskName 'Nawasrah ERP Quarterly Restore Drill' -ErrorAction Stop; [pscustomobject]@{backup=$a.LastTaskResult;restore=$b.LastTaskResult}|ConvertTo-Json -Compress"]);
  try {
    const taskResults = JSON.parse(tasks.stdout);
    checks.push(check('developer:backup:scheduled-tasks', 'Windows Task Scheduler', 'high', tasks.ok && taskResults.backup === 0 && [0, 267011].includes(taskResults.restore), tasks.ok && taskResults.backup === 0 && [0, 267011].includes(taskResults.restore) ? 'مهام Backup وRestore Drill لم تسجل فشلًا.' : 'إحدى مهام Backup أوRestore Drill سجلت فشلًا.', {backupResult: taskResults.backup, restoreResult: taskResults.restore}));
  } catch {
    checks.push(check('developer:backup:scheduled-tasks', 'Windows Task Scheduler', 'high', false, 'تعذر قراءة نتائج مهام Backup وRestore Drill.'));
  }
  const n8nTask = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$i=Get-ScheduledTaskInfo -TaskName 'Nawasrah n8n Daily Backup' -ErrorAction Stop; [string]$i.LastTaskResult"]);
  const n8nTaskResult = Number(n8nTask.stdout);
  checks.push(check(
    'developer:backup:n8n-task',
    'Windows Task Scheduler',
    'high',
    n8nTask.ok && n8nTaskResult === 0,
    n8nTask.ok && n8nTaskResult === 0 ? 'مهمة n8n Backup المجدولة ناجحة.' : 'مهمة n8n Backup المجدولة فاشلة أو غير متاحة.',
    {lastTaskResult: Number.isFinite(n8nTaskResult) ? n8nTaskResult : 'unavailable'},
  ));
  try {
    const status = await readJson(path.join(backupRoot, 'last-backup-status.json'));
    const age = ageHours(status.finishedAt);
    const healthy = status.ok === true && Number.isFinite(age) && age <= 36;
    checks.push(check('developer:backup:nightly', 'Backup', 'critical', healthy, healthy ? 'آخر نسخة ERP الاحتياطية سليمة وحديثة.' : 'آخر نسخة ERP فاشلة أو أقدم من 36 ساعة.', {ageHours: Number.isFinite(age) ? age.toFixed(1) : 'invalid', provider: status.dumpProvider || 'unknown'}));
  } catch {
    checks.push(check('developer:backup:nightly', 'Backup', 'critical', false, 'حالة آخر نسخة ERP غير متاحة.'));
  }
  try {
    const n8nStatusRoot = process.env.NAWASRAH_N8N_BACKUP_STATUS_ROOT || 'C:\\ProgramData\\NawasrahN8nBackup';
    const status = await readJson(path.join(n8nStatusRoot, 'last-status.json'));
    const age = ageHours(status.finishedAt);
    const archivePath = path.join(backupRoot, path.basename(String(status.archiveName || '')));
    const archive = await stat(archivePath);
    const healthy = status.ok === true
      && status.restoreVerified === true
      && status.liveVolumesModified === false
      && archive.isFile()
      && archive.size === status.archiveBytes
      && Number.isFinite(age)
      && age <= 36;
    checks.push(check('developer:backup:n8n', 'n8n Backup', 'critical', healthy, healthy ? 'آخر نسخة n8n حديثة واجتازت Restore Drill المعزول.' : 'نسخة n8n فاشلة أو قديمة أو لم تجتز Restore Drill.', {ageHours: Number.isFinite(age) ? age.toFixed(1) : 'invalid', restoreVerified: status.restoreVerified === true}));
  } catch {
    checks.push(check('developer:backup:n8n', 'n8n Backup', 'critical', false, 'حالة نسخة n8n أو Restore Drill غير متاحة.'));
  }
  try {
    const status = await readJson(path.join(backupRoot, 'last-restore-drill-status.json'));
    const age = ageHours(status.completedAt) / 24;
    const healthy = status.ok === true && status.liveSupabaseTouched === false && Number.isFinite(age) && age <= 91;
    checks.push(check('developer:backup:restore-drill', 'Restore Drill', 'high', healthy, healthy ? 'آخر Restore Drill معزول وسليم.' : 'Restore Drill فاشل أو متأخر عن 91 يومًا.', {ageDays: Number.isFinite(age) ? age.toFixed(1) : 'invalid'}));
  } catch {
    checks.push(check('developer:backup:restore-drill', 'Restore Drill', 'high', false, 'حالة Restore Drill غير متاحة.'));
  }
  return checks;
}

function collectSupabaseChecks() {
  const psql = process.env.NAWASRAH_PSQL_PATH;
  const databaseUrl = process.env.NAWASRAH_SUPABASE_DATABASE_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!psql || !databaseUrl || !password) {
    return [check('developer:supabase:monitoring-query', 'Supabase', 'high', false, 'إعداد قراءة Supabase للـwatchdog غير مكتمل.')];
  }
  const sql = `SET default_transaction_read_only=on; WITH capabilities AS (
    SELECT to_regprocedure('public.get_business_summary_monitoring_status()') IS NOT NULL AS summaries_installed
  ) SELECT json_build_object(
    'summary_monitoring_installed', (SELECT summaries_installed FROM capabilities),
    'missing_jobs', (SELECT count(*) FROM (VALUES ('expire-stale-new-website-orders',true),('cleanup-guest-order-gateway-requests',true),('scan-core-business-alerts',true),('scan-business-summaries',(SELECT summaries_installed FROM capabilities))) expected(name,required) LEFT JOIN cron.job j ON j.jobname=expected.name WHERE expected.required AND (j.jobid IS NULL OR NOT j.active)),
    'recent_failures', (SELECT count(*) FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname IN ('expire-stale-new-website-orders','cleanup-guest-order-gateway-requests','scan-core-business-alerts','scan-business-summaries') AND d.start_time >= now()-interval '30 minutes' AND d.status <> 'succeeded'),
    'stale_jobs', (SELECT count(*) FROM cron.job j WHERE (j.jobname='expire-stale-new-website-orders' AND NOT EXISTS (SELECT 1 FROM cron.job_run_details d WHERE d.jobid=j.jobid AND d.status='succeeded' AND d.start_time>=now()-interval '15 minutes')) OR (j.jobname='cleanup-guest-order-gateway-requests' AND NOT EXISTS (SELECT 1 FROM cron.job_run_details d WHERE d.jobid=j.jobid AND d.status='succeeded' AND d.start_time>=now()-interval '30 minutes')) OR (j.jobname='scan-core-business-alerts' AND NOT EXISTS (SELECT 1 FROM cron.job_run_details d WHERE d.jobid=j.jobid AND d.status='succeeded' AND d.start_time>=now()-interval '15 minutes')) OR (j.jobname='scan-business-summaries' AND NOT EXISTS (SELECT 1 FROM cron.job_run_details d WHERE d.jobid=j.jobid AND d.status='succeeded' AND d.start_time>=now()-interval '15 minutes'))),
    'retryable_backlog', (SELECT count(*) FROM public.automation_event_deliveries d JOIN public.automation_events e ON e.id=d.event_id WHERE e.created_at>=now()-interval '30 days' AND d.updated_at<now()-interval '10 minutes' AND d.status IN ('pending','failed') AND d.next_attempt_at<=now() AND d.attempt_count<10),
    'stuck_leases', (SELECT count(*) FROM public.automation_event_deliveries WHERE status='processing' AND lease_expires_at<=now()),
    'dead_letters', (SELECT count(*) FROM public.automation_event_deliveries WHERE status='dead_letter' OR (status<>'delivered' AND attempt_count>=10)),
    'latency_breaches', (SELECT count(*) FROM public.automation_event_deliveries d JOIN public.automation_events e ON e.id=d.event_id WHERE d.status NOT IN ('delivered','dead_letter') AND e.created_at<=now()-interval '10 minutes')
  );`;
  const env = {...process.env, PGPASSWORD: password};
  const result = run(psql, [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], 30_000, env);
  if (!result.ok) return [check('developer:supabase:monitoring-query', 'Supabase', 'high', false, 'تعذر تنفيذ فحص Supabase الآمن.')];
  try {
    const metrics = JSON.parse(result.stdout.split(/\r?\n/u).filter((line) => line.trim().startsWith('{')).at(-1));
    const checks = [
      check('developer:supabase:monitoring-query', 'Supabase', 'high', true, 'فحص Supabase التقني يعمل.'),
      check('developer:supabase:cron', 'Supabase Cron', 'high', metrics.missing_jobs === 0 && metrics.recent_failures === 0 && metrics.stale_jobs === 0, 'حالة Supabase cron.', {missingJobs: metrics.missing_jobs, recentFailures: metrics.recent_failures, staleJobs: metrics.stale_jobs}),
      check('developer:automation:backlog', 'Automation Delivery', 'high', metrics.retryable_backlog === 0, 'حالة Business delivery backlog التقنية بدون محتوى أعمال.', {backlog: metrics.retryable_backlog}),
      check('developer:automation:stuck-lease', 'Automation Delivery', 'high', metrics.stuck_leases === 0, 'حالة Business delivery leases التقنية.', {stuckLeases: metrics.stuck_leases}),
      check('developer:automation:dead-letter', 'Automation Delivery', 'high', metrics.dead_letters === 0, 'حالة Business delivery dead-letter التقنية.', {deadLetters: metrics.dead_letters}),
      check('developer:automation:latency', 'Automation Delivery', 'medium', metrics.latency_breaches === 0, 'حالة Business delivery latency التقنية.', {latencyBreaches: metrics.latency_breaches}),
    ];
    if (metrics.summary_monitoring_installed === true) {
      const summaryResult = run(psql, [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', "SET default_transaction_read_only=on; SELECT public.get_business_summary_monitoring_status();"], 30_000, env);
      if (!summaryResult.ok) {
        checks.push(check('developer:business-summary:schedule', 'Business Summary Scheduler', 'high', false, 'تعذر قراءة حالة جدولة ملخصات الأعمال.'));
      } else {
        const status = JSON.parse(summaryResult.stdout.split(/\r?\n/u).filter((line) => line.trim().startsWith('{')).at(-1));
        const missed = Number(status.unresolvedMissedPeriods || 0);
        const overdue = Number(status.overdueDeliveries || 0);
        checks.push(check(
          'developer:business-summary:schedule',
          'Business Summary Scheduler',
          'high',
          missed === 0 && overdue === 0,
          'حالة جدولة وتسليم ملخصات الأعمال التقنية بدون محتوى أعمال.',
          {unresolvedMissedPeriods: missed, overdueDeliveries: overdue},
        ));
      }
    }
    const advancedCapability = runMonitoringSql("SET default_transaction_read_only=on; SELECT to_regprocedure('public.get_advanced_monitoring_status()') IS NOT NULL;");
    if (advancedCapability.ok && advancedCapability.stdout.split(/\r?\n/u).some((line) => line.trim() === 't')) {
      const advanced = runMonitoringSql('SET default_transaction_read_only=on; SELECT public.get_advanced_monitoring_status();');
      if (!advanced.ok) {
        checks.push(check('developer:integrity:monitoring-scan', 'Business Integrity', 'high', false, 'تعذر قراءة فحوص سلامة البيانات.'));
      } else {
        const status = JSON.parse(advanced.stdout.split(/\r?\n/u).filter((line) => line.trim().startsWith('{')).at(-1));
        const grouped = new Map();
        for (const item of status.checks || []) {
          if (item.status === 'healthy' || item.status === 'unknown') continue;
          const family = ['inventory', 'orders'].includes(item.category)
            ? 'inventory'
            : ['accounting', 'shifts'].includes(item.category)
              ? 'accounting'
              : item.category;
          const current = grouped.get(family) || {issueCount: 0, severity: 'medium'};
          current.issueCount += Number(item.issueCount || 0);
          if (item.status === 'critical') current.severity = item.severity === 'critical' ? 'critical' : 'high';
          grouped.set(family, current);
        }
        const families = ['inventory', 'accounting', 'automation', 'performance', 'database', 'security', 'runtime'];
        for (const family of families) {
          const incident = grouped.get(family);
          checks.push(check(
            `developer:integrity:${family}`,
            'Advanced Monitoring',
            incident?.severity || 'high',
            !incident,
            incident ? `اكتشفت فحوص ${family} مؤشرات تحتاج المراجعة.` : `فحوص ${family} سليمة.`,
            {issueCount: incident?.issueCount || 0},
          ));
        }
      }
    }
    return checks;
  } catch {
    return [check('developer:supabase:monitoring-query', 'Supabase', 'high', false, 'نتيجة فحص Supabase غير متوقعة.')];
  }
}

async function collectPublicServiceChecks() {
  const checks = [];
  try {
    const response = await fetch('https://api.github.com/repos/OBITO20011/mahdi-admin/actions/runs?per_page=20', {
      headers: {'user-agent': 'nawasrah-developer-watchdog', accept: 'application/vnd.github+json'},
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub Actions API returned ${response.status}.`);
    const body = await response.json();
    const expectedWorkflows = [
      'Nawasrah code quality',
      'Nawasrah secret scanning',
      'Nawasrah public uptime',
    ];
    const latestCompleted = new Map();
    for (const item of body.workflow_runs || []) {
      if (item.status === 'completed' && expectedWorkflows.includes(item.name) && !latestCompleted.has(item.name)) {
        latestCompleted.set(item.name, item);
      }
    }
    const relevant = [...latestCompleted.values()];
    if (relevant.length !== expectedWorkflows.length) {
      throw new Error('GitHub Actions API window is missing a required workflow.');
    }
    const failed = relevant.filter((item) => item.conclusion !== 'success');
    checks.push(check('developer:github:ci', 'GitHub Actions', 'high', relevant.length === expectedWorkflows.length && failed.length === 0,
      failed.length === 0 ? 'آخر نتائج CI وSecret Scanning وUptime ناجحة.' : 'أحد GitHub release gates فاشل.',
      {workflowCount: relevant.length, failedCount: failed.length}));
  } catch {
    const workflowBadges = await Promise.all([
      'quality.yml',
      'secrets.yml',
      'public-uptime.yml',
    ].map(async (workflow) => {
      try {
        const response = await fetch(
          `https://github.com/OBITO20011/mahdi-admin/actions/workflows/${workflow}/badge.svg?branch=main`,
          {signal: AbortSignal.timeout(15_000)},
        );
        const badge = await response.text();
        return response.ok && /\bpassing\b/u.test(badge);
      } catch {
        return false;
      }
    }));
    const passingCount = workflowBadges.filter(Boolean).length;
    checks.push(check(
      'developer:github:ci',
      'GitHub Actions',
      'high',
      passingCount === workflowBadges.length,
      passingCount === workflowBadges.length
        ? 'آخر نتائج CI وSecret Scanning وUptime ناجحة.'
        : 'تعذر إثبات نجاح جميع GitHub release gates.',
      {workflowCount: workflowBadges.length, passingCount, source: 'workflow-badges'},
    ));
  }
  for (const service of [
    {key: 'admin', url: 'https://nawasrah-admin.pages.dev'},
    {key: 'customer', url: 'https://nawasrah-store.pages.dev'},
  ]) {
    try {
      const response = await fetch(service.url, {redirect: 'follow', signal: AbortSignal.timeout(15_000)});
      checks.push(check(`developer:uptime:${service.key}`, 'Public Uptime', 'high', response.ok,
        response.ok ? `${service.key} endpoint متاح.` : `${service.key} endpoint أعاد حالة غير ناجحة.`, {httpStatus: response.status}));
    } catch {
      checks.push(check(`developer:uptime:${service.key}`, 'Public Uptime', 'high', false, `${service.key} endpoint غير متاح.`));
    }
  }
  return checks;
}

function publishExternalMonitoringSnapshot(checks) {
  const allHealthy = (prefixes) => {
    const matched = checks.filter((item) => prefixes.some((prefix) => item.key.startsWith(prefix)));
    return matched.length > 0 && matched.every((item) => item.healthy);
  };
  const items = [
    {key: 'external:infrastructure:docker', category: 'infrastructure', severity: 'high', healthy: allHealthy(['developer:docker:']), summary: 'Docker Safe Startup'},
    {key: 'external:infrastructure:n8n', category: 'infrastructure', severity: 'high', healthy: allHealthy(['developer:n8n:']), summary: 'n8n container and health'},
    {key: 'external:backup:erp', category: 'backup', severity: 'critical', healthy: allHealthy(['developer:backup:nightly', 'developer:backup:scheduled-tasks']), summary: 'ERP backup'},
    {key: 'external:backup:n8n', category: 'backup', severity: 'critical', healthy: allHealthy(['developer:backup:n8n']), summary: 'n8n backup'},
    {key: 'external:backup:restore', category: 'backup', severity: 'high', healthy: allHealthy(['developer:backup:restore-drill']), summary: 'Restore drill'},
    {key: 'external:deployment:github', category: 'deployment', severity: 'high', healthy: allHealthy(['developer:github:ci']), summary: 'GitHub release gates'},
    {key: 'external:deployment:uptime', category: 'deployment', severity: 'high', healthy: allHealthy(['developer:uptime:']), summary: 'Public uptime'},
    {key: 'external:deployment:cloudflare-admin', category: 'deployment', severity: 'high', healthy: allHealthy(['developer:cloudflare:admin']), summary: 'Cloudflare Admin deployment'},
    {key: 'external:deployment:cloudflare-customer', category: 'deployment', severity: 'high', healthy: allHealthy(['developer:cloudflare:customer']), summary: 'Cloudflare Customer deployment'},
  ].map((item) => ({
    key: item.key,
    category: item.category,
    status: item.healthy ? 'healthy' : 'critical',
    severity: item.severity,
    issueCount: item.healthy ? 0 : 1,
    summary: item.summary,
    details: {},
  }));
  const encoded = Buffer.from(JSON.stringify(items), 'utf8').toString('base64');
  return runMonitoringSql(`SELECT public.record_external_monitoring_snapshot(convert_from(decode('${encoded}','base64'),'UTF8')::jsonb);`);
}

async function collectCloudflareChecks() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) return [check('developer:cloudflare:configuration', 'Cloudflare', 'high', false, 'إعداد Cloudflare read-only غير مكتمل.')];
  const projects = [
    {name: 'nawasrah-admin', key: 'admin', relevant: (file) => /^(?:src\/|public\/|index\.html$|package(?:-lock)?\.json$|vite\.config\.ts$)/u.test(file)},
    {name: 'nawasrah-store', key: 'customer', relevant: (file) => file.startsWith('customer-web/')},
  ];
  const checks = [];
  const githubHeaders = {'user-agent': 'nawasrah-developer-watchdog', accept: 'application/vnd.github+json'};
  const projectRoot = process.env.NAWASRAH_PROJECT_ROOT;
  let mainSha = '';
  if (projectRoot) {
    const remote = run('git.exe', ['-C', projectRoot, 'ls-remote', 'origin', 'refs/heads/main'], 30_000);
    if (remote.ok) mainSha = remote.stdout.split(/\s+/u)[0] || '';
  }
  if (!mainSha) {
    try {
      const mainResponse = await fetch('https://api.github.com/repos/OBITO20011/mahdi-admin/commits/main', {headers: githubHeaders, signal: AbortSignal.timeout(15_000)});
      const main = await mainResponse.json();
      if (mainResponse.ok) mainSha = main.sha || '';
    } catch {
      mainSha = '';
    }
  }
  for (const project of projects) {
    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project.name}/deployments?env=production&per_page=1`, {headers: {authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(15_000)});
      const body = await response.json();
      const deployment = body?.result?.[0];
      const deployedSha = deployment?.deployment_trigger?.metadata?.commit_hash
        || deployment?.source?.config?.commit_hash
        || '';
      const successful = response.ok && body?.success === true && deployment?.latest_stage?.status === 'success';
      let relevantChanges = true;
      if (successful && mainSha && deployedSha) {
        if (deployedSha === mainSha) {
          relevantChanges = false;
        } else {
          const localComparison = projectRoot
            ? run('git.exe', ['-C', projectRoot, 'diff', '--name-only', `${deployedSha}..${mainSha}`], 30_000)
            : {ok: false, stdout: ''};
          if (localComparison.ok) {
            relevantChanges = localComparison.stdout.split(/\r?\n/u).filter(Boolean).some(project.relevant);
          } else {
            const compareResponse = await fetch(`https://api.github.com/repos/OBITO20011/mahdi-admin/compare/${deployedSha}...${mainSha}`, {headers: githubHeaders, signal: AbortSignal.timeout(15_000)});
            const comparison = await compareResponse.json();
            relevantChanges = !compareResponse.ok || comparison.status === 'diverged' || (comparison.files || []).some((file) => project.relevant(file.filename || ''));
          }
        }
      }
      const aligned = successful && Boolean(mainSha) && Boolean(deployedSha) && !relevantChanges;
      checks.push(check(`developer:cloudflare:${project.key}`, 'Cloudflare Pages', 'high', aligned, aligned ? `${project.name} deployment ناجح ولا توجد تغييرات تطبيق غير منشورة.` : `${project.name} deployment فاشل أو توجد تغييرات تطبيق غير منشورة.`, {deploymentStatus: deployment?.latest_stage?.status || 'unavailable', deployedSha: deployedSha.slice(0, 12) || 'unavailable', mainSha: mainSha.slice(0, 12) || 'unavailable'}));
    } catch {
      checks.push(check(`developer:cloudflare:${project.key}`, 'Cloudflare Pages', 'high', false, `تعذر قراءة حالة ${project.name}.`));
    }
  }
  return checks;
}

async function loadState() {
  try { return await readJson(statePath); } catch { return {version: 1, incidents: {}}; }
}

async function acquireLock() {
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify({pid: process.pid, createdAt: new Date().toISOString()})}\n`, 'utf8');
    return handle;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    try {
      const info = await stat(lockPath);
      if (now.getTime() - info.mtimeMs <= 10 * 60_000) return null;
      const stalePath = `${lockPath}.stale-${now.getTime()}`;
      await rename(lockPath, stalePath);
      await unlink(stalePath).catch(() => undefined);
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${JSON.stringify({pid: process.pid, createdAt: new Date().toISOString(), recoveredStaleLock: true})}\n`, 'utf8');
      return handle;
    } catch (retryError) {
      if (retryError?.code === 'ENOENT' || retryError?.code === 'EEXIST') return null;
      throw retryError;
    }
  }
}

async function saveState(state) {
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporary, statePath);
}

async function main() {
  await mkdir(root, {recursive: true});
  const lock = await acquireLock();
  if (!lock) {
    process.stdout.write('Developer watchdog skipped because another instance owns the lock.\n');
    return;
  }
  try {
    const checks = [
      ...await collectLocalChecks(),
      ...await collectBackupChecks(),
      ...collectSupabaseChecks(),
      ...await collectCloudflareChecks(),
      ...await collectPublicServiceChecks(),
    ];
    const advancedInstalled = runMonitoringSql("SET default_transaction_read_only=on; SELECT to_regprocedure('public.record_external_monitoring_snapshot(jsonb,timestamp with time zone)') IS NOT NULL;");
    if (advancedInstalled.ok && advancedInstalled.stdout.split(/\r?\n/u).some((line) => line.trim() === 't')) {
      const published = publishExternalMonitoringSnapshot(checks);
      checks.push(check('developer:monitoring:dashboard-sync', 'Monitoring Dashboard', 'medium', published.ok,
        published.ok ? 'تم تحديث مؤشرات الخدمات الخارجية في لوحة Admin.' : 'فشل تحديث مؤشرات الخدمات الخارجية في لوحة Admin.'));
    }
    if (probeOnly) {
      process.stdout.write(`${JSON.stringify({
        ok: checks.every((item) => item.healthy),
        checks: checks.map(({key, severity, healthy}) => ({key, severity, healthy})),
      })}\n`);
      return;
    }
    const state = await loadState();
    const result = await runIncidentCycle({
      checks,
      state,
      now,
      send: ({message}) => sendTelegramMessage({
        botToken: process.env.NAWASRAH_DEV_TELEGRAM_BOT_TOKEN,
        chatId: process.env.NAWASRAH_DEV_TELEGRAM_CHAT_ID,
        message,
      }),
    });
    await saveState(result.state);
    process.stdout.write(`${JSON.stringify({ok: result.notifications.every((item) => item.delivered), checks: checks.length, notifications: result.notifications.length})}\n`);
    if (result.notifications.some((item) => !item.delivered)) process.exitCode = 1;
  } finally {
    await lock?.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

await main();
