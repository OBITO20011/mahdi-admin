import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { decryptFile } from './backup-crypto.mjs';

const execFileAsync = promisify(execFile);
const REQUIRED_ARCHIVE_FILES = [
  'manifest.json',
  'database/roles.sql',
  'database/schema.sql',
  'database/data.sql',
];

function normalizeArchivePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function runTar(args) {
  const { stdout } = await execFileAsync('tar.exe', args, {
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

export async function verifyBackupArchive({ archivePath, passphrase, extractTo = undefined }) {
  await access(archivePath);
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'nawasrah-verify-'));
  const decryptedTar = path.join(tempRoot, 'backup.tar');
  const extractedRoot = path.join(tempRoot, 'contents');

  try {
    await decryptFile(archivePath, decryptedTar, passphrase);
    const listing = (await runTar(['-tf', decryptedTar]))
      .split(/\r?\n/u)
      .map(normalizeArchivePath)
      .filter(Boolean);

    for (const archivedPath of listing) {
      const segments = archivedPath.split('/');
      if (path.posix.isAbsolute(archivedPath)
        || segments.some((segment) => segment === '..')) {
        throw new Error(`Unsafe path in backup archive: ${archivedPath}`);
      }
    }

    for (const requiredFile of REQUIRED_ARCHIVE_FILES) {
      if (!listing.includes(requiredFile)) {
        throw new Error(`Backup archive is missing ${requiredFile}.`);
      }
    }

    await mkdir(extractedRoot, { recursive: true });
    await runTar(['-xf', decryptedTar, '-C', extractedRoot]);
    const manifestPath = path.join(extractedRoot, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    if (manifest.formatVersion !== 1 || !Array.isArray(manifest.files)) {
      throw new Error('Backup manifest has an unsupported format.');
    }

    for (const entry of manifest.files) {
      const normalized = normalizeArchivePath(String(entry.path ?? ''));
      const filePath = path.resolve(extractedRoot, ...normalized.split('/'));
      const relative = path.relative(extractedRoot, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Unsafe path in backup manifest: ${normalized}`);
      }

      const fileStats = await stat(filePath);
      if (fileStats.size !== entry.size || (await sha256(filePath)) !== entry.sha256) {
        throw new Error(`Backup checksum validation failed for ${normalized}.`);
      }
    }

    if (extractTo) {
      const resolvedExtractTo = path.resolve(extractTo);
      await cp(extractedRoot, resolvedExtractTo, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }

    return {
      createdAt: manifest.createdAt,
      databaseFiles: manifest.databaseFiles,
      storageObjectCount: manifest.storageObjectCount,
      verifiedFileCount: manifest.files.length,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--file') result.archivePath = argv[++index];
    else if (argument === '--extract-to') result.extractTo = argv[++index];
  }
  return result;
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const options = parseArguments(process.argv.slice(2));
  const passphrase = process.env.NAWASRAH_BACKUP_PASSPHRASE;
  if (!options.archivePath || !passphrase) {
    throw new Error('Use --file and set NAWASRAH_BACKUP_PASSPHRASE.');
  }

  const result = await verifyBackupArchive({
    archivePath: path.resolve(options.archivePath),
    passphrase,
    extractTo: options.extractTo ? path.resolve(options.extractTo) : undefined,
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}
