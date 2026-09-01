import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  listStorageObjects,
  readPublicSupabaseConfig,
} from './create-backup.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const expectedProjectRef = 'acjtabdqqnpwhdvbvnyw';

async function commandSucceeds(command, args = []) {
  try {
    await execFileAsync(command, args, { windowsHide: true, timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
await access(cliPath);
await access(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe'));

const linkedProjectRef = (await readFile(
  path.join(projectRoot, 'supabase', '.temp', 'project-ref'),
  'utf8'
)).trim();
if (linkedProjectRef !== expectedProjectRef) {
  throw new Error(`Linked Supabase project mismatch: ${linkedProjectRef}.`);
}

const publicConfig = await readPublicSupabaseConfig(projectRoot);
const storageObjects = await listStorageObjects({
  ...publicConfig,
  bucket: 'product-images',
});
const dockerInstalled = await commandSucceeds('docker.exe', ['--version']);
const dockerReady = dockerInstalled
  ? await commandSucceeds('docker.exe', ['info', '--format', '{{.ServerVersion}}'])
  : false;
const configuredPgBin = process.env.NAWASRAH_PG_BIN
  || path.join(process.env.LOCALAPPDATA || '', 'NawasrahBackup', 'postgresql-17.11', 'bin');
const nativePgTools = await commandSucceeds(path.join(configuredPgBin, 'pg_dump.exe'), ['--version']);

console.log(JSON.stringify({
  ok: true,
  projectRef: linkedProjectRef,
  supabaseCli: true,
  tar: true,
  productImagesReachable: true,
  productImageCount: storageObjects.length,
  nativePgTools,
  dockerInstalled,
  dockerReady,
  note: nativePgTools
    ? 'Ready for unattended native PostgreSQL database dumps.'
    : (dockerReady
      ? 'Interactive Docker backup is available, but unattended scheduling requires native PostgreSQL tools.'
      : 'Install the official PostgreSQL 17 Windows binaries before enabling unattended backup.'),
}, null, 2));

if (!nativePgTools) {
  process.exitCode = 1;
}
