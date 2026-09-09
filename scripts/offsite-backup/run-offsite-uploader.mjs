import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {BUCKET_NAME, PIPELINES, buildObjectKey, loadVerifiedLocalBackup, publicStatusError} from './offsite-core.mjs';
import {createR2Client, downloadAndVerify, latestArchiveObject, listObjects, probeBucket, putImmutableArchive} from './r2-client.mjs';

const command = process.argv[2] || 'upload';
const root = process.env.NAWASRAH_OFFSITE_STATUS_ROOT || 'C:\\ProgramData\\NawasrahOffsiteBackup';
const bucket = process.env.NAWASRAH_R2_BUCKET || BUCKET_NAME;
const client = createR2Client({
  accountId: process.env.NAWASRAH_R2_ACCOUNT_ID,
  accessKeyId: process.env.NAWASRAH_R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.NAWASRAH_R2_SECRET_ACCESS_KEY,
  jurisdiction: process.env.NAWASRAH_R2_JURISDICTION || 'eu',
});

const statusPath = (pipelineName) => path.join(root, `${pipelineName}-status.json`);
async function readStatus(pipelineName) {
  try { return JSON.parse((await readFile(statusPath(pipelineName), 'utf8')).replace(/^\uFEFF/u, '')); } catch { return {version: 1, pipeline: pipelineName}; }
}
async function writeStatus(pipelineName, value) {
  await mkdir(root, {recursive: true});
  const target = statusPath(pipelineName);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

async function runUpload(pipelineName) {
  const sourceStatus = process.env[`NAWASRAH_${pipelineName.toUpperCase()}_BACKUP_STATUS`];
  if (!sourceStatus) throw new Error(`${pipelineName} local status path is not configured.`);
  const local = await loadVerifiedLocalBackup(pipelineName, sourceStatus);
  const dailyKey = buildObjectKey(pipelineName, 'daily', local.finishedAt, local.archiveName);
  const daily = await putImmutableArchive(client, {
    bucket, key: dailyKey, filePath: local.archivePath, bytes: local.archiveBytes,
    digest: local.sha256, pipelineName,
  });
  const monthPrefix = `${pipelineName}/monthly/${dailyKey.split('/').slice(2, 4).join('/')}/`;
  const monthlyExisting = (await listObjects(client, bucket, monthPrefix)).filter((item) => item.Key?.endsWith('.nwb'));
  let monthlyKey = monthlyExisting[0]?.Key || null;
  if (!monthlyKey) {
    monthlyKey = buildObjectKey(pipelineName, 'monthly', local.finishedAt, local.archiveName);
    await putImmutableArchive(client, {
      bucket, key: monthlyKey, filePath: local.archivePath, bytes: local.archiveBytes,
      digest: local.sha256, pipelineName,
    });
  }
  const current = await readStatus(pipelineName);
  await writeStatus(pipelineName, {
    ...current, version: 1, pipeline: pipelineName, ok: true,
    lastAttemptAt: new Date().toISOString(), lastUploadAt: new Date().toISOString(),
    localArchiveName: local.archiveName, remoteKey: dailyKey, monthlyKey,
    archiveBytes: local.archiveBytes, sha256: local.sha256,
    uploaded: daily.uploaded, remoteVerified: true, error: null,
  });
  return {pipeline: pipelineName, key: dailyKey, bytes: local.archiveBytes, sha256: local.sha256, uploaded: daily.uploaded};
}

async function runVerify(pipelineName, outputRoot) {
  const latest = await latestArchiveObject(client, bucket, `${pipelineName}/daily/`);
  const outputPath = path.join(outputRoot, pipelineName, path.basename(latest.Key));
  const result = await downloadAndVerify(client, {bucket, key: latest.Key, outputPath});
  const current = await readStatus(pipelineName);
  await writeStatus(pipelineName, {
    ...current, ok: true, remoteVerified: true,
    lastDownloadVerifiedAt: new Date().toISOString(), downloadedKey: result.key,
    downloadedBytes: result.bytes, downloadedSha256: result.sha256, error: null,
  });
  return {pipeline: pipelineName, ...result};
}

async function markFailure(pipelineName, error) {
  const current = await readStatus(pipelineName);
  await writeStatus(pipelineName, {
    ...current, version: 1, pipeline: pipelineName, ok: false,
    lastAttemptAt: new Date().toISOString(), error: publicStatusError(error),
  });
}

try {
  await probeBucket(client, bucket);
  const results = [];
  if (command === 'probe') {
    results.push({ok: true, bucket});
  } else if (command === 'upload') {
    for (const pipelineName of PIPELINES) {
      try { results.push(await runUpload(pipelineName)); }
      catch (error) { await markFailure(pipelineName, error); throw error; }
    }
  } else if (command === 'verify' || command === 'download-restore') {
    const outputRoot = process.env.NAWASRAH_OFFSITE_DOWNLOAD_ROOT;
    if (!outputRoot) throw new Error('Off-site download root is not configured.');
    for (const pipelineName of PIPELINES) {
      try { results.push(await runVerify(pipelineName, outputRoot)); }
      catch (error) { await markFailure(pipelineName, error); throw error; }
    }
    if (command === 'download-restore') {
      await writeFile(path.join(outputRoot, 'restore-inputs.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    }
  } else if (command === 'mark-restore') {
    const manifest = JSON.parse((await readFile(process.env.NAWASRAH_OFFSITE_RESTORE_RESULT, 'utf8')).replace(/^\uFEFF/u, ''));
    for (const item of manifest.results) {
      const current = await readStatus(item.pipeline);
      await writeStatus(item.pipeline, {
        ...current, ok: true, remoteVerified: true, remoteRestoreVerified: true,
        lastRestoreVerifiedAt: manifest.completedAt, restoredKey: item.key,
        restoredSha256: item.sha256, error: null,
      });
    }
    results.push({marked: manifest.results.length});
  } else {
    throw new Error(`Unknown off-site command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify({ok: true, command, results})}\n`);
} catch (error) {
  process.stderr.write(`${publicStatusError(error)}\n`);
  process.exitCode = 1;
} finally {
  client.destroy();
}
