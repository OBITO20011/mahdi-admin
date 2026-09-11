import {execFile, spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const sqlPath = path.join(here, 'business-summaries-runtime.sql');
const projectId = process.env.NAWASRAH_ISOLATED_PROJECT_ID
  || 'nawasrah-business-summaries-runtime';
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
    else reject(new Error(`Business Summaries runtime SQL failed (exit ${code}): ${stderr.trim()}`));
  });
  child.stdin.end(sql);
});

if (process.env.NAWASRAH_SKIP_BOOTSTRAP !== '1') {
  const {stdout} = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: root,
    env: {...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId},
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 360_000,
  });
  if (!JSON.parse(stdout).ok) throw new Error('Isolated Supabase bootstrap failed.');
}

const output = await runSql(await readFile(sqlPath, 'utf8'));
const summaryLine = output.split(/\r?\n/u).find((line) => line.startsWith('{'));
const summary = summaryLine ? JSON.parse(summaryLine) : null;
if (!summary?.ok || summary.runtime_scenarios !== 12) {
  throw new Error(`Business Summaries runtime suite failed: ${output}`);
}

console.log(JSON.stringify({
  ok: true,
  runtimeScenarios: summary.runtime_scenarios,
  scenarios: summary.scenarios,
}, null, 2));
