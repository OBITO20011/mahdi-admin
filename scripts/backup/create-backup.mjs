import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  access,
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { encryptFile, BACKUP_FORMAT } from './backup-crypto.mjs';
import { verifyBackupArchive } from './verify-backup.mjs';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const BACKUP_PREFIX = 'nawasrah-backup-';
const STATUS_FILE = 'last-backup-status.json';
const LOG_FILE = 'backup.log';

function requireEnvironment(name, minimumLength = 1) {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new Error(`Required environment value ${name} is missing or too short.`);
  }
  return value;
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/u, 'Z');
}

function redact(value, secrets) {
  return secrets.reduce(
    (current, secret) => (secret ? current.replaceAll(secret, '[REDACTED]') : current),
    String(value)
  );
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function safeStoragePath(prefix, name) {
  const normalizedPrefix = String(prefix || '').replace(/^\/+|\/+$/gu, '');
  const normalizedName = String(name || '').replace(/^\/+|\/+$/gu, '');
  const storagePath = [normalizedPrefix, normalizedName].filter(Boolean).join('/');
  const segments = storagePath.split('/');
  if (!storagePath || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe Storage object path: ${storagePath}`);
  }
  return storagePath;
}

function encodeStoragePath(storagePath) {
  return storagePath.split('/').map(encodeURIComponent).join('/');
}

export async function readPublicSupabaseConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'src', 'config', 'supabase-public-config.ts');
  const source = await readFile(configPath, 'utf8');
  const url = source.match(/SUPABASE_URL:\s*['"]([^'"]+)['"]/u)?.[1];
  const publishableKey = source.match(/SUPABASE_PUBLISHABLE_KEY:\s*['"]([^'"]+)['"]/u)?.[1];
  if (!url || !publishableKey) {
    throw new Error('Could not read the public Supabase URL and publishable key.');
  }
  return { url: url.replace(/\/$/u, ''), publishableKey };
}

export async function listStorageObjects({ url, publishableKey, bucket, prefix = '' }) {
  const objects = [];
  const headers = {
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
    'Content-Type': 'application/json',
  };
  let offset = 0;

  while (true) {
    const response = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prefix,
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    });
    if (!response.ok) {
      throw new Error(`Storage listing failed (${response.status}).`);
    }

    const page = await response.json();
    for (const entry of page) {
      const objectPath = safeStoragePath(prefix, entry.name);
      if (entry.id == null && entry.metadata == null) {
        objects.push(...await listStorageObjects({
          url,
          publishableKey,
          bucket,
          prefix: `${objectPath}/`,
        }));
      } else {
        objects.push({ path: objectPath, metadata: entry.metadata ?? null });
      }
    }

    if (page.length < 100) break;
    offset += page.length;
  }

  return objects;
}

async function downloadStorageObjects({ url, publishableKey, bucket, destination }) {
  const objects = await listStorageObjects({ url, publishableKey, bucket });
  const downloaded = [];

  for (const object of objects) {
    const response = await fetch(
      `${url}/storage/v1/object/public/${bucket}/${encodeStoragePath(object.path)}`,
      { headers: { apikey: publishableKey } }
    );
    if (!response.ok) {
      throw new Error(`Storage download failed for ${object.path} (${response.status}).`);
    }

    const targetPath = path.join(destination, ...object.path.split('/'));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
    downloaded.push(object.path);
  }

  return downloaded;
}

async function runSupabaseDump({ projectRoot, outputPath, arguments: dumpArguments, secrets }) {
  const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
  await access(cliPath);
  try {
    await execFileAsync(process.execPath, [
      cliPath,
      'db',
      'dump',
      '--linked',
      '--workdir',
      projectRoot,
      '--file',
      outputPath,
      '--yes',
      '--log-level',
      'warn',
      ...dumpArguments,
    ], {
      cwd: projectRoot,
      windowsHide: true,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const detail = redact(error.stderr || error.message, secrets);
    if (/password authentication failed/iu.test(detail)) {
      throw new Error(
        'Supabase rejected the database password. Use the Database password from Project Settings > Database, not the admin login password.'
      );
    }
    throw new Error(`Supabase database dump failed: ${detail}`);
  }

  const outputStats = await stat(outputPath);
  if (outputStats.size === 0) {
    throw new Error(`Supabase produced an empty dump: ${path.basename(outputPath)}.`);
  }
}

async function collectFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, fullPath));
    else if (entry.isFile()) {
      const fileStats = await stat(fullPath);
      files.push({
        path: path.relative(root, fullPath).replaceAll('\\', '/'),
        size: fileStats.size,
        sha256: await sha256(fullPath),
      });
    }
  }
  return files;
}

async function pruneOldBackups(outputRoot, retentionCount) {
  const resolvedOutput = path.resolve(outputRoot);
  const entries = await readdir(resolvedOutput, { withFileTypes: true });
  const backups = entries
    .filter((entry) => entry.isFile()
      && entry.name.startsWith(BACKUP_PREFIX)
      && entry.name.endsWith(BACKUP_FORMAT.extension))
    .map((entry) => path.join(resolvedOutput, entry.name))
    .sort()
    .reverse();

  for (const backupPath of backups.slice(retentionCount)) {
    const relative = path.relative(resolvedOutput, path.resolve(backupPath));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Refusing to prune outside the backup directory: ${backupPath}`);
    }
    await rm(backupPath, { force: true });
  }
}

async function writeStatus(outputRoot, status) {
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    path.join(outputRoot, STATUS_FILE),
    `${JSON.stringify(status, null, 2)}\n`,
    'utf8'
  );
  await appendFile(
    path.join(outputRoot, LOG_FILE),
    `${status.finishedAt}\t${status.ok ? 'SUCCESS' : 'FAILED'}\t${status.message}\n`,
    'utf8'
  );
}

export async function createBackup(options = {}) {
  const startedAt = new Date();
  const projectRoot = path.resolve(options.projectRoot || process.env.NAWASRAH_PROJECT_ROOT || DEFAULT_PROJECT_ROOT);
  const outputRoot = path.resolve(options.outputRoot || requireEnvironment('NAWASRAH_BACKUP_OUTPUT'));
  const passphrase = options.passphrase || requireEnvironment('NAWASRAH_BACKUP_PASSPHRASE', 16);
  const databasePassword = options.databasePassword || requireEnvironment('SUPABASE_DB_PASSWORD', 8);
  const retentionCount = Number.parseInt(
    String(options.retentionCount || process.env.NAWASRAH_BACKUP_RETENTION || '30'),
    10
  );
  if (!Number.isInteger(retentionCount) || retentionCount < 2 || retentionCount > 365) {
    throw new Error('Backup retention must be between 2 and 365 archives.');
  }

  const timestamp = timestampForFile(startedAt);
  const finalPath = path.join(outputRoot, `${BACKUP_PREFIX}${timestamp}${BACKUP_FORMAT.extension}`);
  const partialPath = `${finalPath}.partial`;
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'nawasrah-backup-'));
  const contentsRoot = path.join(tempRoot, 'contents');
  const databaseRoot = path.join(contentsRoot, 'database');
  const storageRoot = path.join(contentsRoot, 'storage', 'product-images');
  const tarPath = path.join(tempRoot, 'backup.tar');
  const secrets = [databasePassword, passphrase];

  await mkdir(outputRoot, { recursive: true });
  await mkdir(databaseRoot, { recursive: true });
  await mkdir(storageRoot, { recursive: true });

  try {
    process.env.SUPABASE_DB_PASSWORD = databasePassword;
    const rolesPath = path.join(databaseRoot, 'roles.sql');
    const schemaPath = path.join(databaseRoot, 'schema.sql');
    const dataPath = path.join(databaseRoot, 'data.sql');
    await runSupabaseDump({
      projectRoot,
      outputPath: rolesPath,
      arguments: ['--role-only'],
      secrets,
    });
    await runSupabaseDump({
      projectRoot,
      outputPath: schemaPath,
      arguments: ['--schema', 'public'],
      secrets,
    });
    await runSupabaseDump({
      projectRoot,
      outputPath: dataPath,
      arguments: ['--data-only', '--use-copy', '--schema', 'public'],
      secrets,
    });

    const migrationsSource = path.join(projectRoot, 'supabase', 'migrations');
    await cp(migrationsSource, path.join(contentsRoot, 'migrations'), { recursive: true });
    await cp(
      path.join(projectRoot, 'supabase', 'config.toml'),
      path.join(contentsRoot, 'supabase-config.toml')
    );

    const publicConfig = await readPublicSupabaseConfig(projectRoot);
    const storageObjects = await downloadStorageObjects({
      ...publicConfig,
      bucket: 'product-images',
      destination: storageRoot,
    });

    const files = await collectFiles(contentsRoot);
    const manifest = {
      formatVersion: 1,
      system: 'Nawasrah ERP',
      createdAt: startedAt.toISOString(),
      projectRef: 'acjtabdqqnpwhdvbvnyw',
      databaseFiles: ['database/roles.sql', 'database/schema.sql', 'database/data.sql'],
      storageBucket: 'product-images',
      storageObjectCount: storageObjects.length,
      files,
    };
    await writeFile(
      path.join(contentsRoot, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );

    await execFileAsync('tar.exe', ['-cf', tarPath, '-C', contentsRoot, '.'], {
      windowsHide: true,
    });
    await encryptFile(tarPath, partialPath, passphrase);
    await verifyBackupArchive({ archivePath: partialPath, passphrase });
    await rename(partialPath, finalPath);
    await pruneOldBackups(outputRoot, retentionCount);

    const archiveStats = await stat(finalPath);
    const result = {
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      archivePath: finalPath,
      archiveSize: archiveStats.size,
      storageObjectCount: storageObjects.length,
      retentionCount,
      message: `Verified encrypted backup created: ${path.basename(finalPath)}`,
    };
    await writeStatus(outputRoot, result);
    return result;
  } catch (error) {
    await rm(partialPath, { force: true });
    const result = {
      ok: false,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      message: redact(error instanceof Error ? error.message : error, secrets),
    };
    await writeStatus(outputRoot, result);
    throw new Error(result.message);
  } finally {
    delete process.env.SUPABASE_DB_PASSWORD;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const result = await createBackup();
  console.log(JSON.stringify(result, null, 2));
}
