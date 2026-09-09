import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {buildObjectKey, isDue, loadVerifiedLocalBackup, sha256, sidecarKey} from '../scripts/offsite-backup/offsite-core.mjs';
import {putImmutableArchive} from '../scripts/offsite-backup/r2-client.mjs';
import {runIncidentCycle} from '../scripts/monitoring/developer-alert-core.mjs';

test('off-site object keys keep ERP and n8n daily/monthly namespaces independent', () => {
  assert.equal(
    buildObjectKey('erp', 'daily', '2026-09-09T13:56:23Z', 'nawasrah-backup-2026-09-09T13-56-23Z.nwb'),
    'erp/daily/2026/09/09/nawasrah-backup-2026-09-09T13-56-23Z.nwb',
  );
  assert.equal(
    buildObjectKey('n8n', 'monthly', '2026-09-09T01:30:06Z', 'nawasrah-n8n-20260909-013006.nwb'),
    'n8n/monthly/2026/09/nawasrah-n8n-20260909-013006.nwb',
  );
  assert.throws(() => buildObjectKey('erp', 'daily', new Date(), '..\\secret.nwb'));
});

test('weekly and 90-day gates are deterministic', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  assert.equal(isDue('2026-09-02T11:59:59Z', 168, now), true);
  assert.equal(isDue('2026-09-02T12:00:01Z', 168, now), false);
  assert.equal(isDue(undefined, 2160, now), true);
});

test('only locally successful and restore-verified n8n archives are eligible', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nawasrah-offsite-'));
  try {
    const archivePath = path.join(root, 'nawasrah-n8n-20260909-013006.nwb');
    const statusPath = path.join(root, 'status.json');
    await writeFile(archivePath, 'encrypted fixture');
    const digest = await sha256(archivePath);
    await writeFile(statusPath, JSON.stringify({
      ok: true, restoreVerified: true, liveVolumesModified: false,
      archivePath, archiveName: path.basename(archivePath), archiveBytes: 17,
      sha256: digest, finishedAt: '2026-09-09T01:30:06Z',
    }));
    const verified = await loadVerifiedLocalBackup('n8n', statusPath);
    assert.equal(verified.sha256, digest);
    await writeFile(statusPath, JSON.stringify({
      ok: true, restoreVerified: false, liveVolumesModified: false,
      archivePath, archiveName: path.basename(archivePath), archiveBytes: 17,
      finishedAt: '2026-09-09T01:30:06Z',
    }));
    await assert.rejects(loadVerifiedLocalBackup('n8n', statusPath), /restore verification/u);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('PowerShell UTF-8 BOM status is accepted', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nawasrah-offsite-bom-'));
  try {
    const archivePath = path.join(root, 'nawasrah-backup-2026-09-09T13-56-23Z.nwb');
    const statusPath = path.join(root, 'status.json');
    await writeFile(archivePath, 'encrypted');
    await writeFile(statusPath, `\uFEFF${JSON.stringify({ok: true, archivePath, archiveSize: 9, finishedAt: '2026-09-09T13:56:23Z'})}`);
    const verified = await loadVerifiedLocalBackup('erp', statusPath);
    assert.equal(verified.archiveBytes, 9);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('immutable upload writes archive and SHA sidecar once and rerun is idempotent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nawasrah-r2-'));
  try {
    const filePath = path.join(root, 'nawasrah-backup-2026-09-09T13-56-23Z.nwb');
    await writeFile(filePath, 'encrypted');
    const digest = await sha256(filePath);
    const objects = new Map<string, {body: Buffer; metadata: Record<string, string>}>();
    const client = {send: async (command: {constructor: {name: string}; input: Record<string, unknown>}) => {
      const key = String(command.input.Key || '');
      if (command.constructor.name === 'HeadObjectCommand') {
        const object = objects.get(key);
        if (!object) { const error = Object.assign(new Error('missing'), {$metadata: {httpStatusCode: 404}}); throw error; }
        return {ContentLength: object.body.length, Metadata: object.metadata};
      }
      if (command.constructor.name === 'PutObjectCommand') {
        if (objects.has(key)) { const error = Object.assign(new Error('exists'), {$metadata: {httpStatusCode: 412}}); throw error; }
        const body = command.input.Body;
        const chunks: Buffer[] = [];
        if (typeof body === 'string') chunks.push(Buffer.from(body));
        else for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
        objects.set(key, {body: Buffer.concat(chunks), metadata: command.input.Metadata as Record<string, string>});
        return {};
      }
      if (command.constructor.name === 'GetObjectCommand') {
        const object = objects.get(key)!;
        return {Body: {transformToString: async () => object.body.toString('utf8')}};
      }
      throw new Error('unexpected command');
    }};
    const key = 'erp/daily/2026/09/09/nawasrah-backup-2026-09-09T13-56-23Z.nwb';
    const first = await putImmutableArchive(client as never, {bucket: 'bucket', key, filePath, bytes: 9, digest, pipelineName: 'erp'});
    const second = await putImmutableArchive(client as never, {bucket: 'bucket', key, filePath, bytes: 9, digest, pipelineName: 'erp'});
    assert.equal(first.uploaded, true);
    assert.equal(second.uploaded, false);
    assert.equal(objects.get(sidecarKey(key))?.body.toString(), `${digest}  ${path.basename(key)}\n`);
    assert.equal(objects.size, 2);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('off-site scripts never request object deletion and status files cannot include secrets', async () => {
  const clientSource = await readFile(path.resolve('scripts/offsite-backup/r2-client.mjs'), 'utf8');
  const runnerSource = await readFile(path.resolve('scripts/offsite-backup/run-offsite-uploader.mjs'), 'utf8');
  assert.doesNotMatch(clientSource, /DeleteObjectCommand/u);
  const statusWrites = [...runnerSource.matchAll(/writeStatus\([\s\S]*?\n\s*\}\);/gu)].map((match) => match[0]).join('\n');
  assert.doesNotMatch(statusWrites, /NAWASRAH_R2_ACCESS_KEY_ID/u);
  assert.doesNotMatch(statusWrites, /NAWASRAH_R2_SECRET_ACCESS_KEY/u);
});

test('Windows setup uses DPAPI SYSTEM, independent schedules, bounded retries, and overlap lock', async () => {
  const [setup, register, runner] = await Promise.all([
    readFile(path.resolve('scripts/offsite-backup/setup-offsite-backup.ps1'), 'utf8'),
    readFile(path.resolve('scripts/offsite-backup/register-offsite-backup-tasks.ps1'), 'utf8'),
    readFile(path.resolve('scripts/offsite-backup/run-offsite-backup.ps1'), 'utf8'),
  ]);
  assert.match(setup, /DataProtectionScope\]::LocalMachine/u);
  assert.match(setup, /NT AUTHORITY\\SYSTEM/u);
  assert.match(register, /-UserId 'SYSTEM'/u);
  assert.match(register, /-MultipleInstances IgnoreNew/u);
  assert.match(register, /-RestartCount 2/u);
  assert.match(register, /-At '02:10'/u);
  assert.match(register, /-DaysOfWeek Sunday -At '03:00'/u);
  assert.match(register, /-At '03:30'/u);
  assert.match(runner, /offsite\.lock/u);
  assert.match(runner, /lastRestoreVerifiedAt' 2160/u);
  assert.doesNotMatch(`${setup}\n${register}\n${runner}`, /DeleteObject|Remove-S3Object/u);
});

test('scheduled verification starts the registered SYSTEM uploader and requires zero exit code', async () => {
  const source = await readFile(path.resolve('scripts/offsite-backup/test-offsite-schedule.ps1'), 'utf8');
  assert.match(source, /Start-ScheduledTask -TaskName \$TaskName/u);
  assert.match(source, /LastTaskResult -ne 0/u);
  assert.match(source, /Principal\.UserId/u);
  assert.match(source, /AddMinutes\(5\)/u);
});

test('off-site incident emits one failure, no duplicate, and one recovery', async () => {
  const sent: string[] = [];
  const check = {
    key: 'developer:backup:offsite:erp', source: 'ERP Off-site Backup', severity: 'critical',
    healthy: false, summary: 'Remote verification failed.', observedAt: '2026-09-09T10:00:00Z',
  };
  const first = await runIncidentCycle({checks: [check], send: async ({kind}) => { sent.push(kind); return true; }, now: new Date('2026-09-09T10:00:00Z')});
  const duplicate = await runIncidentCycle({checks: [check], state: first.state, send: async ({kind}) => { sent.push(kind); return true; }, now: new Date('2026-09-09T10:05:00Z')});
  const recovery = await runIncidentCycle({checks: [{...check, healthy: true}], state: duplicate.state, send: async ({kind}) => { sent.push(kind); return true; }, now: new Date('2026-09-09T10:10:00Z')});
  assert.deepEqual(sent, ['incident', 'recovery']);
  assert.equal(recovery.state.incidents[check.key].active, false);
});
