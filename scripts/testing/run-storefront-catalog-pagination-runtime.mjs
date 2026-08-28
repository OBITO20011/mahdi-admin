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
  'storefront-catalog-pagination-runtime.sql'
);
const isolatedDatabaseContainer = 'supabase_db_nawasrah-phase7-test';

const { stdout: bootstrapOutput } = await execFileAsync(
  process.execPath,
  [bootstrapPath],
  { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 }
);
const bootstrapResult = JSON.parse(bootstrapOutput);
if (!bootstrapResult.ok) {
  throw new Error('The isolated Supabase bootstrap did not complete.');
}

const sql = await readFile(runtimeSqlPath, 'utf8');
await new Promise((resolve, reject) => {
  const child = spawn(
    'docker',
    [
      'exec', '-i', isolatedDatabaseContainer, 'psql', '-U', 'postgres',
      '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    ],
    { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolve(undefined);
    else reject(new Error(`Catalog pagination runtime SQL failed: ${stderr}`));
  });
  child.stdin.end(sql);
});

console.log(JSON.stringify({
  ok: true,
  scope: ['server-side page after product 200', 'server-side search for product 201'],
}, null, 2));
