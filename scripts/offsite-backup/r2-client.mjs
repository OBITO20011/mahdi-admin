import {createReadStream} from 'node:fs';
import {mkdir, open, rename, rm, stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {sha256, sidecarKey} from './offsite-core.mjs';

export function createR2Client({accountId, accessKeyId, secretAccessKey, jurisdiction = 'eu'}) {
  if (!/^[a-f0-9]{32}$/u.test(accountId)) throw new Error('Cloudflare account id is invalid.');
  if (!accessKeyId || !secretAccessKey) throw new Error('R2 runtime credentials are unavailable.');
  const suffix = jurisdiction === 'eu' ? '.eu' : '';
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}${suffix}.r2.cloudflarestorage.com`,
    credentials: {accessKeyId, secretAccessKey},
    forcePathStyle: true,
    maxAttempts: 3,
  });
}

async function headOrNull(client, bucket, key) {
  try {
    return await client.send(new HeadObjectCommand({Bucket: bucket, Key: key}));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null;
    throw error;
  }
}

export async function putImmutableArchive(client, {bucket, key, filePath, bytes, digest, pipelineName}) {
  const existing = await headOrNull(client, bucket, key);
  if (existing) {
    const existingHash = String(existing.Metadata?.sha256 || '').toLowerCase();
    if (Number(existing.ContentLength) !== bytes || existingHash !== digest.toLowerCase()) {
      throw new Error(`Immutable object conflict for ${key}.`);
    }
    return {uploaded: false, verified: true};
  }
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: bytes,
      ContentType: 'application/octet-stream',
      IfNoneMatch: '*',
      Metadata: {sha256: digest, pipeline: pipelineName, encrypted: 'aes-256-gcm'},
    }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 412) throw error;
  }
  const verified = await headOrNull(client, bucket, key);
  if (!verified || Number(verified.ContentLength) !== bytes
      || String(verified.Metadata?.sha256 || '').toLowerCase() !== digest.toLowerCase()) {
    throw new Error(`Remote object verification failed for ${key}.`);
  }
  const sidecar = `${digest}  ${path.basename(key)}\n`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: sidecarKey(key),
    Body: sidecar,
    ContentLength: Buffer.byteLength(sidecar),
    ContentType: 'text/plain; charset=utf-8',
    IfNoneMatch: '*',
    Metadata: {sha256: digest},
  })).catch(async (error) => {
    if (error?.$metadata?.httpStatusCode !== 412) throw error;
    const current = await readObjectText(client, bucket, sidecarKey(key));
    if (current !== sidecar) throw new Error(`Immutable checksum conflict for ${key}.`);
  });
  return {uploaded: true, verified: true};
}

export async function listObjects(client, bucket, prefix) {
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken,
    }));
    objects.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

export async function latestArchiveObject(client, bucket, prefix) {
  const objects = (await listObjects(client, bucket, prefix))
    .filter((item) => item.Key?.endsWith('.nwb'))
    .sort((left, right) => {
      const time = Number(right.LastModified || 0) - Number(left.LastModified || 0);
      return time || String(right.Key).localeCompare(String(left.Key));
    });
  if (!objects[0]?.Key) throw new Error(`No remote backup exists under ${prefix}.`);
  return objects[0];
}

export async function readObjectText(client, bucket, key) {
  const response = await client.send(new GetObjectCommand({Bucket: bucket, Key: key}));
  return response.Body.transformToString('utf8');
}

export async function downloadAndVerify(client, {bucket, key, outputPath}) {
  await mkdir(path.dirname(outputPath), {recursive: true});
  const partial = `${outputPath}.partial`;
  await rm(partial, {force: true});
  const response = await client.send(new GetObjectCommand({Bucket: bucket, Key: key}));
  const expectedHash = String(response.Metadata?.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expectedHash)) throw new Error(`Remote SHA-256 metadata is invalid for ${key}.`);
  await pipeline(Readable.fromWeb(response.Body.transformToWebStream()), (await open(partial, 'w')).createWriteStream());
  const digest = await sha256(partial);
  const file = await stat(partial);
  if (digest !== expectedHash || Number(response.ContentLength) !== file.size) {
    throw new Error(`Downloaded object integrity mismatch for ${key}.`);
  }
  const sidecar = await readObjectText(client, bucket, sidecarKey(key));
  if (sidecar !== `${digest}  ${path.basename(key)}\n`) throw new Error(`Remote checksum sidecar mismatch for ${key}.`);
  await rm(outputPath, {force: true});
  await rename(partial, outputPath);
  return {key, outputPath, bytes: file.size, sha256: digest};
}

export async function probeBucket(client, bucket) {
  await client.send(new ListObjectsV2Command({Bucket: bucket, MaxKeys: 1}));
  return true;
}
