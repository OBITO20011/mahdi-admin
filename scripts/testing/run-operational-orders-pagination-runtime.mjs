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
  'operational-orders-pagination-runtime.sql'
);
const databaseContainer = 'supabase_db_nawasrah-phase7-test';

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
      {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
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
      else {
        reject(
          new Error(
            `Operational orders pagination runtime failed (exit ${code}): ${stderr.trim()}`
          )
        );
      }
    });
    child.stdin.end(sql);
  });

const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
  cwd: projectRoot,
  windowsHide: true,
  maxBuffer: 1024 * 1024,
});
const bootstrap = JSON.parse(stdout);
if (!bootstrap.ok) {
  throw new Error('The isolated Supabase bootstrap did not succeed.');
}

const sql = await readFile(runtimeSqlPath, 'utf8');
const output = await runSql(sql);
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
  throw new Error(
    `Operational orders pagination runtime failed: ${JSON.stringify(summary)}`
  );
}

console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
