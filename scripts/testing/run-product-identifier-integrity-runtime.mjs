import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const bootstrapPath = path.join(scriptDirectory, 'bootstrap-isolated-supabase.mjs');
const runtimeSqlPath = path.join(
  scriptDirectory,
  'product-identifier-integrity-runtime.sql'
);
const databaseContainer = 'supabase_db_nawasrah-product-identifiers-test';
const cliPath = path.join(
  projectRoot,
  'node_modules',
  'supabase',
  'dist',
  'supabase.js'
);

const runSql = (sql) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        databaseContainer,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-q',
        '-t',
        '-A',
      ],
      { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Identifier runtime failed: ${stderr.trim()}`));
    });
    child.stdin.end(sql);
  });

let isolatedProjectRoot = '';

try {
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID: 'nawasrah-product-identifiers-test',
    },
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 360_000,
  });
  const bootstrap = JSON.parse(stdout);
  if (!bootstrap.ok || typeof bootstrap.isolatedProjectRoot !== 'string') {
    throw new Error('The isolated Supabase bootstrap did not succeed.');
  }
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;

  const output = await runSql(await readFile(runtimeSqlPath, 'utf8'));
  const summaryLine = output
    .split(/\r?\n/)
    .find((line) => line.startsWith('{') && line.includes('runtime_scenarios'));
  if (!summaryLine) {
    throw new Error(`Runtime did not produce a JSON summary. Output: ${output}`);
  }
  const summary = JSON.parse(summaryLine);
  if (
    summary.unexpected_failures !== 0 ||
    summary.passed !== summary.runtime_scenarios
  ) {
    throw new Error(`Identifier runtime failed: ${JSON.stringify(summary)}`);
  }
  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
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
      }
    );
  }
}
