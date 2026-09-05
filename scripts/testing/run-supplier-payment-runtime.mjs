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
const warehouseTransferRuntimeSqlPath = path.join(
  scriptDirectory,
  'warehouse-transfer-runtime.sql',
);
const isolatedProjectId = 'nawasrah-supplier-payments-test';
const isolatedDatabaseContainer = `supabase_db_${isolatedProjectId}`;
let isolatedProjectRoot = '';

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

const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');

try {
  if (process.env.NAWASRAH_SKIP_BOOTSTRAP !== '1') {
    const { stdout: bootstrapOutput } = await execFileAsync(
      process.execPath,
      [bootstrapPath],
      {
        cwd: projectRoot,
        env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: isolatedProjectId },
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: 360_000,
      },
    );

    const bootstrapResult = JSON.parse(bootstrapOutput);
    if (!bootstrapResult.ok || typeof bootstrapResult.isolatedProjectRoot !== 'string') {
      throw new Error('The isolated Supabase bootstrap did not return a test project root.');
    }
    isolatedProjectRoot = bootstrapResult.isolatedProjectRoot;
  }

  await runRuntimeSql(runtimeSqlPath, 'supplier-payment');
  if (isolatedProjectRoot) {
    await execFileAsync(process.execPath, [cliPath, 'db', 'reset', '--local', '--workdir', isolatedProjectRoot], {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 180_000,
    });
  }
  await runRuntimeSql(finalBlockersRuntimeSqlPath, 'final-admin-blockers');
  if (isolatedProjectRoot) {
    await execFileAsync(process.execPath, [cliPath, 'db', 'reset', '--local', '--workdir', isolatedProjectRoot], {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 180_000,
    });
  }
  await runRuntimeSql(warehouseTransferRuntimeSqlPath, 'warehouse-transfer');

  const { stdout: lintOutput } = await execFileAsync(
    process.execPath,
    [cliPath, 'db', 'lint', '--local', '--level', 'warning', '--workdir', isolatedProjectRoot],
    {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    },
  );
  if (lintOutput.includes('v_product_name')) {
    throw new Error(`Migration 095 did not remove the target lint warning: ${lintOutput}`);
  }
} finally {
  if (isolatedProjectRoot) {
    await execFileAsync(
      process.execPath,
      [cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot],
      {
        cwd: projectRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: 120_000,
      },
    );
  }
}

console.log(JSON.stringify({
  ok: true,
  scope: [
    'supplier-payment idempotency retry',
    'supplier-receipt-payment idempotency retry',
    'cashier/view_only direct-write denial',
    'POS credit debt/payment/reversal reconciliation',
    'customer history 1,000-row server pagination',
    'POS customer 251/500/1,000 server search',
    'warehouse transfer success/failure/reconciliation and role gates',
    'v_product_name lint warning removal',
  ],
  targetLintWarningRemoved: true,
}, null, 2));
