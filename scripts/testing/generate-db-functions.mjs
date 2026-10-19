import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {migrationManifest, renderFunctionReference, canonicalLf,canonicalDefinitionLf} from './maintenance-db-contract.mjs';

const exec = promisify(execFile), root = path.resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(value => value !== '--check')) throw new Error('Only --check is supported; target is always isolated.');
const manifest = await migrationManifest(root), ceiling = Math.max(...manifest.map(m => Number(m.name.split('_')[0])));
const state = JSON.parse(await readFile(path.join(root, 'docs/agent/project-state.json'), 'utf8'));
assert.equal(ceiling, state.migrationCeiling, 'Generation requires the approved migration ceiling');
const projectId = 'nawasrah-maintenance-reference-test', container = 'supabase_db_' + projectId;
const cli = path.join(root, 'node_modules/supabase/dist/supabase.js');
let workdir, generated, stage = 'bootstrap';
try {
  const {stdout} = await exec(process.execPath, [path.join(root, 'scripts/testing/bootstrap-isolated-supabase.mjs')], {
    cwd: root, windowsHide: true, timeout: 600000, maxBuffer: 8 * 1024 * 1024, env: {...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID: projectId, NAWASRAH_MAX_MIGRATION: String(ceiling),
      NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_SUPABASE_EXCLUDE: 'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot = JSON.parse(stdout); assert.equal(boot.ok, true); assert.equal(boot.isolatedProjectId, projectId); workdir = boot.isolatedProjectRoot;
  stage = 'read-catalog';
  // pg_get_functiondef is read-only HERE, never a source of executable migration patches.
  const query = `BEGIN READ ONLY;
    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'identity'), '[]'::jsonb) FROM (
      SELECT jsonb_build_object('identity', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        'owner', pg_get_userbyid(p.proowner), 'securityDefiner', p.prosecdef, 'volatility', p.provolatile,
        'configuration', COALESCE(to_jsonb(p.proconfig), '[]'::jsonb), 'acl', to_jsonb(p.proacl),
        'executeGrants', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', CASE WHEN a.grantee=0 THEN 'PUBLIC'
          ELSE pg_get_userbyid(a.grantee) END, 'grantor', pg_get_userbyid(a.grantor), 'grantable', a.is_grantable)
          ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
            pg_get_userbyid(a.grantor),a.is_grantable)
          FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE'),'[]'::jsonb),
        'extension', (SELECT e.extname FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
          WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e' LIMIT 1),
        'definition', pg_get_functiondef(p.oid)) row
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind IN ('f','w','p')
    ) routines; ROLLBACK;`;
  const {stdout: catalog} = await exec('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], {windowsHide: true, maxBuffer: 32 * 1024 * 1024});
  const functions = JSON.parse(catalog.trim()).map(row => ({...row, definition: canonicalDefinitionLf(row.definition)}));
  assert.ok(functions.length > 0); assert.equal(new Set(functions.map(f => f.identity)).size, functions.length);
  assert.deepEqual(await migrationManifest(root), manifest, 'Migration source changed during generation');
  const markdown = renderFunctionReference(manifest, functions);
  stage = check ? 'compare-reference' : 'emit-reference';
  if (check) assert.equal(canonicalLf(await readFile(path.join(root, 'docs/generated/DB_FUNCTIONS.md'), 'utf8')), markdown,
    'DB_FUNCTIONS_STALE: regenerate from the isolated database');
  else generated = markdown;
  process.stderr.write(JSON.stringify({ok: true, stage, ceiling, functions: functions.length, productionAccess: false})+'\n');
} catch (error) {
  // CLI error stdout/stderr can contain local credentials; do not emit it.
  process.stderr.write(JSON.stringify({ok: false, stage, kind: error.name})+'\n'); process.exitCode = 1;
} finally {
  if (workdir) await exec(process.execPath, [cli, 'stop', '--no-backup', '--workdir', workdir], {windowsHide: true, timeout: 120000});
}
if (generated && !process.exitCode) {
  // Mechanical generated artifact only, AFTER the isolated process is stopped.
  await mkdir(path.join(root, 'docs/generated'), {recursive: true});
  await writeFile(path.join(root, 'docs/generated/DB_FUNCTIONS.md'), generated, 'utf8');
}
