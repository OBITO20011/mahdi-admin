import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '../..');
export const statePath = resolve(root, 'docs/agent/project-state.json');
export const taskPath = resolve(root, 'docs/agent/ACTIVE_TASK.json');

export function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex').toUpperCase();
}

export function canonicalLf(value) {
  return String(value).replace(/\r\n?/gu, '\n');
}

export function canonicalTextSha256(value) {
  return sha256(canonicalLf(value));
}

export function fileSha256(path) {
  return sha256(readFileSync(path));
}

export function fileCanonicalTextSha256(path) {
  return canonicalTextSha256(readFileSync(path, 'utf8'));
}

export function statusEntries() {
  const output = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (!output) return [];
  const chunks = output.split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const raw = chunks[index];
    const code = raw.slice(0, 2);
    let path = raw.slice(3);
    if (code.includes('R') || code.includes('C')) {
      const destination = chunks[index + 1];
      if (destination) {
        path = `${path} -> ${destination}`;
        index += 1;
      }
    }
    entries.push({ code, path: path.replaceAll('\\', '/') });
  }
  return entries.sort((a, b) => `${a.code} ${a.path}`.localeCompare(`${b.code} ${b.path}`));
}

export function handoffRelevantEntries() {
  return statusEntries().filter(({ path }) => ![
    'docs/agent/ACTIVE_TASK.json',
    'docs/agent/HANDOFF_HISTORY.md',
  ].includes(path));
}

export function workingTreeFingerprint() {
  return sha256(JSON.stringify(handoffRelevantEntries()));
}

export function commandVersion(command, args = ['--version']) {
  const isCommandShim = process.platform === 'win32' && ['npm', 'code'].includes(command);
  const executable = isCommandShim ? (process.env.ComSpec || 'cmd.exe') : command;
  const commandArgs = isCommandShim ? ['/d', '/s', '/c', `${command}.cmd ${args.join(' ')}`] : args;
  const result = spawnSync(executable, commandArgs, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || result.stderr || '').trim().split(/\r?\n/u)[0] || 'available';
}

export function migrationInventory() {
  const state = readJson(statePath);
  const migration121 = resolve(root, 'supabase/migrations/121_phase42_atomic_return_coordinator.sql');
  const migration122 = resolve(root, 'supabase/migrations/122_phase43_admin_aftercare_integration.sql');
  const migration123 = resolve(root, 'supabase/migrations/123_phase5_private_financial_evidence_foundation.sql');
  const migration124 = resolve(root, 'supabase/migrations/124_phase5_canonical_collection_reversal_writers.sql');
  const migration125 = resolve(root, 'supabase/migrations/125_phase5_collection_lock_lint_correction.sql');
  const migration126 = resolve(root, 'supabase/migrations/126_phase5_private_tender_coordinator.sql');
  const migration127 = resolve(root, 'supabase/migrations/127_phase5_private_financial_read_model.sql');
  const migration128 = resolve(root, 'supabase/migrations/128_phase5_operational_payment_and_shift_refund_fixes.sql');
  const migrationFiles = readdirSync(resolve(root, 'supabase/migrations'));
  return {
    ceiling: state.migrationCeiling,
    unexpectedAboveCeiling: migrationFiles.filter((name) => /^\d+_.*\.sql$/u.test(name)
      && Number(name.split('_')[0]) > state.migrationCeiling),
    migration121Exists: existsSync(migration121),
    migration121Sha256: existsSync(migration121) ? fileSha256(migration121) : null,
    migration122Exists: existsSync(migration122),
    migration122Sha256: existsSync(migration122) ? fileSha256(migration122) : null,
    migration122CanonicalLfSha256: existsSync(migration122)
      ? fileCanonicalTextSha256(migration122)
      : null,
    migration123Absent: !migrationFiles.some((name) => name.startsWith('123_') && name.endsWith('.sql')),
    migration123Exists: existsSync(migration123),
    migration123Sha256: existsSync(migration123) ? fileSha256(migration123) : null,
    migration124Absent: !migrationFiles.some((name) => name.startsWith('124_') && name.endsWith('.sql')),
    migration124Exists: existsSync(migration124),
    migration124CanonicalLfSha256: existsSync(migration124)
      ? fileCanonicalTextSha256(migration124)
      : null,
    migration125Exists: existsSync(migration125),
    migration125CanonicalLfSha256: existsSync(migration125)
      ? fileCanonicalTextSha256(migration125) : null,
    migration126Exists: existsSync(migration126),
    migration126CanonicalLfSha256: existsSync(migration126)
      ? fileCanonicalTextSha256(migration126) : null,
    migration127Exists: existsSync(migration127),
    migration127CanonicalLfSha256: existsSync(migration127)
      ? fileCanonicalTextSha256(migration127) : null,
    migration128Exists: existsSync(migration128),
    migration128CanonicalLfSha256: existsSync(migration128)
      ? fileCanonicalTextSha256(migration128) : null,
  };
}

export function productionEnvironmentNames() {
  const pattern = /(PRODUCTION|PROD_|_PROD|LIVE_|_LIVE|SERVICE_ROLE|DATABASE_URL|SUPABASE_DB_PASSWORD)/iu;
  return Object.keys(process.env).filter((name) => pattern.test(name) && process.env[name]).sort();
}

export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    values[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return values;
}
