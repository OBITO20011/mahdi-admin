import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const bootstrapPath = path.join(scriptDirectory, 'bootstrap-isolated-supabase.mjs');
const runtimeSqlPath = path.join(scriptDirectory, 'supplier-payment-runtime.sql');
const finalBlockersRuntimeSqlPath = path.join(
  scriptDirectory,
  'final-admin-blockers-runtime.sql',
);
const isolatedDatabaseContainer = 'supabase_db_nawasrah-phase7-test';

const runRuntimeSql = async (sqlPath, label) => {
  const sql = await readFile(sqlPath, 'utf8');

  await new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        isolatedDatabaseContainer,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Isolated ${label} runtime SQL failed: ${stderr}`));
    });
    child.stdin.end(sql);
  });
};

const { stdout: bootstrapOutput } = await execFileAsync(
  process.execPath,
  [bootstrapPath],
  {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  },
);

const bootstrapResult = JSON.parse(bootstrapOutput);
if (!bootstrapResult.ok || typeof bootstrapResult.isolatedProjectRoot !== 'string') {
  throw new Error('The isolated Supabase bootstrap did not return a test project root.');
}

await runRuntimeSql(runtimeSqlPath, 'supplier-payment');
await runRuntimeSql(finalBlockersRuntimeSqlPath, 'final-admin-blockers');

console.log(JSON.stringify({
  ok: true,
  scope: [
    'supplier-payment idempotency retry',
    'supplier-receipt-payment idempotency retry',
    'cashier/view_only direct-write denial',
    'POS credit debt/payment/reversal reconciliation',
    'customer history 1,000-row server pagination',
    'POS customer 251/500/1,000 server search',
  ],
}, null, 2));
