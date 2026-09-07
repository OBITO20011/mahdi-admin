import {execFile, spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const sqlPath = path.join(here, 'automation-delivery-hardening-runtime.sql');
const projectId = process.env.NAWASRAH_ISOLATED_PROJECT_ID || 'nawasrah-automation-delivery-test';
const databaseContainer = `supabase_db_${projectId}`;

const runSql = (sql) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
  ], {cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(`Automation delivery runtime SQL failed (exit ${code}): ${stderr.trim()}`));
  });
  child.stdin.end(sql);
});

if (process.env.NAWASRAH_SKIP_BOOTSTRAP !== '1') {
  const {stdout} = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: root,
    env: {...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId},
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 300_000,
  });
  if (!JSON.parse(stdout).ok) throw new Error('Isolated Supabase bootstrap failed.');
}

const output = await runSql(await readFile(sqlPath, 'utf8'));
const summaryLine = output.split(/\r?\n/u).find((line) => line.startsWith('{'));
const summary = summaryLine ? JSON.parse(summaryLine) : null;
if (!summary?.ok || summary.runtime_scenarios !== 8) {
  throw new Error(`Automation delivery lifecycle failed: ${output}`);
}

const eventId = crypto.randomUUID();
await runSql(`
  INSERT INTO public.automation_events(id,event_key,event_type,entity_id,payload)
  VALUES ('${eventId}','phase2:concurrent:${eventId}','new_order',gen_random_uuid(),'{}');
  INSERT INTO public.automation_event_deliveries(event_id,channel)
  VALUES ('${eventId}','telegram');
`);
const claims = await Promise.all([
  runSql("SELECT public.claim_automation_deliveries('telegram',1,30);"),
  runSql("SELECT public.claim_automation_deliveries('telegram',1,30);"),
]);
const claimedCount = claims
  .map((value) => JSON.parse(value).items)
  .flat()
  .filter((item) => item.eventId === eventId).length;
const state = JSON.parse(await runSql(`SELECT json_build_object(
  'attempt_count', attempt_count,
  'status', status
) FROM public.automation_event_deliveries WHERE event_id='${eventId}' AND channel='telegram';`));
if (claimedCount !== 1 || state.attempt_count !== 1 || state.status !== 'processing') {
  throw new Error(`Concurrent claim was not exclusive: ${JSON.stringify({claimedCount, state})}`);
}
await runSql(`DELETE FROM public.automation_events WHERE id='${eventId}';`);

console.log(JSON.stringify({
  ok: true,
  runtimeScenarios: 9,
  concurrency: {claimedCount, attemptCount: state.attempt_count},
}, null, 2));
