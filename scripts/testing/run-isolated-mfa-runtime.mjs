import { createHmac, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const isolatedRoot = process.env.NAWASRAH_ISOLATED_ROOT;

if (!isolatedRoot || !path.isAbsolute(isolatedRoot)) {
  throw new Error('NAWASRAH_ISOLATED_ROOT must point to a disposable local Supabase project.');
}

const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const { stdout } = await execFileAsync(
  process.execPath,
  [cliPath, 'status', '-o', 'json', '--workdir', isolatedRoot],
  { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 }
);
const status = JSON.parse(stdout);
const apiUrl = status.API_URL;
const anonKey = status.ANON_KEY;
const serviceRoleKey = status.SERVICE_ROLE_KEY;

if (!apiUrl || !anonKey || !serviceRoleKey || !apiUrl.startsWith('http://127.0.0.1:')) {
  throw new Error('Refusing MFA runtime test because the target is not the local isolated stack.');
}

const adminClient = createClient(apiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const userClient = createClient(apiUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const suffix = randomBytes(6).toString('hex');
const email = `mfa-runtime-${suffix}@example.test`;
const password = `Local-only-${randomBytes(18).toString('base64url')}!9`;
let userId;

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.toUpperCase().replace(/=+$/u, '');
  let bits = '';
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid local TOTP secret format.');
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function createTotp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) % 1_000_000;
  return code.toString().padStart(6, '0');
}

try {
  const created = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw created.error || new Error('Local user creation failed.');
  userId = created.data.user.id;

  const signedIn = await userClient.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' },
  });
  if (signedIn.error) throw signedIn.error;

  const enrolled = await userClient.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Nawasrah isolated runtime',
    issuer: 'Nawasrah isolated test',
  });
  if (enrolled.error) throw enrolled.error;

  const verified = await userClient.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: createTotp(enrolled.data.totp.secret),
  });
  if (verified.error) throw verified.error;

  const aal = await userClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.error) throw aal.error;
  if (aal.data.currentLevel !== 'aal2' || aal.data.nextLevel !== 'aal2') {
    throw new Error('The isolated verified factor did not elevate the session to AAL2.');
  }

  const factors = await userClient.auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  if (!factors.data.totp.some((factor) => factor.id === enrolled.data.id)) {
    throw new Error('The isolated verified TOTP factor was not returned by listFactors.');
  }

  const removed = await userClient.auth.mfa.unenroll({ factorId: enrolled.data.id });
  if (removed.error) throw removed.error;

  console.log(JSON.stringify({
    ok: true,
    environment: 'isolated-local-only',
    flow: ['create-user', 'password-login', 'totp-enroll', 'challenge-verify', 'aal2', 'unenroll'],
    productionAuthChanged: false,
  }));
} finally {
  await userClient.auth.signOut().catch(() => undefined);
  if (userId) await adminClient.auth.admin.deleteUser(userId).catch(() => undefined);
}
