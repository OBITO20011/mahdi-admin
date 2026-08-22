import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { encryptFile, decryptFile } from '../../scripts/backup/backup-crypto.mjs';

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

const inputPath = requiredEnvironment('NAWASRAH_BACKUP_INPUT');
const outputPath = requiredEnvironment('NAWASRAH_BACKUP_OUTPUT');
const verifyPath = requiredEnvironment('NAWASRAH_BACKUP_VERIFY');
const passphrase = requiredEnvironment('NAWASRAH_BACKUP_PASSPHRASE');

await access(inputPath);
await encryptFile(inputPath, outputPath, passphrase);
await decryptFile(outputPath, verifyPath, passphrase);

const [sourceHash, verifiedHash] = await Promise.all([
  sha256(inputPath),
  sha256(verifyPath),
]);

if (sourceHash !== verifiedHash) {
  throw new Error('Encrypted n8n backup verification failed.');
}
