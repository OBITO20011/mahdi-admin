import {access} from 'node:fs/promises';
import {decryptFile} from '../../scripts/backup/backup-crypto.mjs';

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const inputPath = requiredEnvironment('NAWASRAH_N8N_RESTORE_INPUT');
const outputPath = requiredEnvironment('NAWASRAH_N8N_RESTORE_OUTPUT');
const passphrase = requiredEnvironment('NAWASRAH_BACKUP_PASSPHRASE');

await access(inputPath);
await decryptFile(inputPath, outputPath, passphrase);
