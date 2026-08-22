import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('NWBACKUP1', 'ascii');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;

function deriveKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw new Error('Backup passphrase must contain at least 16 characters.');
  }

  return scryptSync(passphrase, salt, 32);
}

async function readSlice(filePath, position, length) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead !== length) {
      throw new Error('Backup archive is truncated.');
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

export async function encryptFile(inputPath, outputPath, passphrase) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);

  await writeFile(outputPath, header);
  await pipeline(
    createReadStream(inputPath),
    cipher,
    createWriteStream(outputPath, { flags: 'a' })
  );
  await appendFile(outputPath, cipher.getAuthTag());
}

export async function decryptFile(inputPath, outputPath, passphrase) {
  const fileStats = await stat(inputPath);
  if (fileStats.size <= HEADER_BYTES + TAG_BYTES) {
    throw new Error('Backup archive is too small to be valid.');
  }

  const header = await readSlice(inputPath, 0, HEADER_BYTES);
  const magic = header.subarray(0, MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error('This is not a Nawasrah backup archive.');
  }

  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = header.subarray(MAGIC.length + SALT_BYTES, HEADER_BYTES);
  const authTag = await readSlice(inputPath, fileStats.size - TAG_BYTES, TAG_BYTES);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(authTag);

  await pipeline(
    createReadStream(inputPath, {
      start: HEADER_BYTES,
      end: fileStats.size - TAG_BYTES - 1,
    }),
    decipher,
    createWriteStream(outputPath)
  );
}

export const BACKUP_FORMAT = Object.freeze({
  extension: '.nwb',
  magic: MAGIC.toString('ascii'),
});
