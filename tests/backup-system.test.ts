import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { encryptFile } from '../scripts/backup/backup-crypto.mjs';
import { verifyBackupArchive } from '../scripts/backup/verify-backup.mjs';

const execFileAsync = promisify(execFile);

test('encrypted backup verifies checksums and rejects a wrong passphrase', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nawasrah-backup-test-'));
  const contents = path.join(root, 'contents');
  const database = path.join(contents, 'database');
  const archiveTar = path.join(root, 'archive.tar');
  const encryptedArchive = path.join(root, 'archive.nwb');
  const passphrase = 'test-only-passphrase-1234';

  try {
    await mkdir(database, { recursive: true });
    const schema = 'CREATE TABLE public.example(id integer);\n';
    const data = 'COPY public.example (id) FROM stdin;\n1\n\\.\n';
    const roles = '-- Supabase custom roles\n';
    await writeFile(path.join(database, 'roles.sql'), roles);
    await writeFile(path.join(database, 'schema.sql'), schema);
    await writeFile(path.join(database, 'data.sql'), data);

    const crypto = await import('node:crypto');
    const entries = await Promise.all([
      ['database/roles.sql', roles],
      ['database/schema.sql', schema],
      ['database/data.sql', data],
    ].map(async ([entryPath, value]) => ({
      path: entryPath,
      size: Buffer.byteLength(value),
      sha256: crypto.createHash('sha256').update(value).digest('hex'),
    })));
    await writeFile(path.join(contents, 'manifest.json'), JSON.stringify({
      formatVersion: 1,
      createdAt: '2026-08-13T00:00:00.000Z',
      databaseFiles: ['database/roles.sql', 'database/schema.sql', 'database/data.sql'],
      storageObjectCount: 0,
      files: entries,
    }));

    await execFileAsync('tar.exe', ['-cf', archiveTar, '-C', contents, '.']);
    await encryptFile(archiveTar, encryptedArchive, passphrase);

    const verification = await verifyBackupArchive({
      archivePath: encryptedArchive,
      passphrase,
    });
    assert.equal(verification.verifiedFileCount, 3);
    assert.equal(verification.storageObjectCount, 0);

    await assert.rejects(
      verifyBackupArchive({
        archivePath: encryptedArchive,
        passphrase: 'incorrect-passphrase-1234',
      })
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backup scripts never contain production secrets', async () => {
  const script = await readFile(
    path.resolve('scripts/backup/create-backup.mjs'),
    'utf8'
  );
  assert.doesNotMatch(script, /service_role/u);
  assert.doesNotMatch(script, /SUPABASE_DB_PASSWORD\s*=\s*['"][^'"]+/u);
});
