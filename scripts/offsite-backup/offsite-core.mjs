import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';

export const PIPELINES = Object.freeze(['erp', 'n8n']);
export const BUCKET_NAME = 'nawasrah-offsite-backups';
export const OFFSITE_MAX_AGE_HOURS = 36;

export function assertPipeline(value) {
  if (!PIPELINES.includes(value)) throw new Error(`Unsupported off-site backup pipeline: ${value}`);
  return value;
}

export function safeArchiveName(value) {
  const name = path.basename(String(value || ''));
  if (!/^nawasrah-(?:backup|n8n)-[A-Za-z0-9T-]+\.nwb$/u.test(name)) {
    throw new Error('Backup archive name is missing or unsafe.');
  }
  return name;
}

export async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export function buildObjectKey(pipeline, cadence, timestamp, archiveName) {
  assertPipeline(pipeline);
  if (!['daily', 'monthly'].includes(cadence)) throw new Error('Invalid backup cadence.');
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) throw new Error('Backup timestamp is invalid.');
  const year = instant.getUTCFullYear().toString().padStart(4, '0');
  const month = (instant.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = instant.getUTCDate().toString().padStart(2, '0');
  const suffix = cadence === 'daily' ? `${year}/${month}/${day}` : `${year}/${month}`;
  return `${pipeline}/${cadence}/${suffix}/${safeArchiveName(archiveName)}`;
}

export function sidecarKey(objectKey) {
  return `${objectKey}.sha256`;
}

export async function loadVerifiedLocalBackup(pipeline, statusPath) {
  assertPipeline(pipeline);
  const statusValue = JSON.parse((await readFile(statusPath, 'utf8')).replace(/^\uFEFF/u, ''));
  if (statusValue.ok !== true) throw new Error(`${pipeline} local backup status is not successful.`);
  if (pipeline === 'n8n' && (statusValue.restoreVerified !== true || statusValue.liveVolumesModified !== false)) {
    throw new Error('n8n local backup has not passed isolated restore verification.');
  }
  const archivePath = String(statusValue.archivePath || '');
  const archiveName = safeArchiveName(statusValue.archiveName || archivePath);
  const archive = await stat(archivePath);
  if (!archive.isFile() || archive.size <= 0) throw new Error(`${pipeline} local backup archive is invalid.`);
  const expectedSize = Number(statusValue.archiveBytes ?? statusValue.archiveSize ?? archive.size);
  if (expectedSize !== archive.size) throw new Error(`${pipeline} local backup size does not match its status file.`);
  const digest = await sha256(archivePath);
  if (statusValue.sha256 && digest.toLowerCase() !== String(statusValue.sha256).toLowerCase()) {
    throw new Error(`${pipeline} local backup SHA-256 does not match its status file.`);
  }
  return {
    pipeline,
    archivePath,
    archiveName,
    archiveBytes: archive.size,
    sha256: digest,
    finishedAt: String(statusValue.finishedAt),
  };
}

export function isDue(lastCompletedAt, intervalHours, now = new Date()) {
  const previous = Date.parse(String(lastCompletedAt || ''));
  return !Number.isFinite(previous) || now.getTime() - previous >= intervalHours * 3_600_000;
}

export function publicStatusError(error) {
  const message = String(error?.message || error || 'Unknown error')
    .replace(/(?:AKIA|[A-Z0-9]{20,})/gu, '[REDACTED]')
    .replace(/(?:secret|token|password|key)\s*[=:]\s*\S+/giu, '$1=[REDACTED]');
  return message.slice(0, 1000);
}
