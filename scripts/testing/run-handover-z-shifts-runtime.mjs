// Real PostgreSQL role/MFA matrix, using supported RPCs for all four states.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor, executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

assert.equal(process.argv.length, 2, 'LOCAL_ONLY_NO_ARGUMENTS');
const root = path.resolve(import.meta.dirname, '../..'), exec = promisify(execFile);
const project = 'nawasrah-zshifts214-test';
const executor = executorFor(['--container', 'supabase_db_' + project]);
const output = await mkdtemp(path.join(tmpdir(), 'nawasrah-zshifts214-'));
const report = {output, managedAccess: false, cases: []};
const id = n => `92600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), q = value => "'" + String(value).replaceAll("'", "''") + "'";
const sql = async text => {
  const result = await executeInput(executor, text);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
};
const json = async text => JSON.parse((await sql(text)).split('\n').at(-1));
const auth = (text, uid = owner, aal = 'aal2', role = 'authenticated') =>
  `BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub: uid, role, aal}))},true);SET LOCAL ROLE ${role};${text}COMMIT;`;
const rpc = (call, uid = owner, aal = 'aal2', role = 'authenticated') =>
  json(auth('SELECT public.' + call + ';', uid, aal, role));
let local, stage = 'bootstrap213';
try {
  const boot = await exec(process.execPath, [path.join(root, 'scripts/testing/bootstrap-isolated-supabase.mjs')], {
    cwd: root, windowsHide: true, maxBuffer: 8 * 1024 ** 2,
    env: {...process.env, NAWASRAH_ISOLATED_PROJECT_ID: project, NAWASRAH_MAX_MIGRATION: '213',
      NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_SUPABASE_EXCLUDE: 'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'},
  });
  local = JSON.parse(boot.stdout).isolatedProjectRoot;
  await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
  await sql(await readFile(path.join(root, 'scripts/testing/package-e-golden-day-fixture.sql'), 'utf8'));
  stage = 'literal214';
  const initial = await readApplicationFingerprint(executor);
  await sql(await readFile(path.join(root, 'supabase/migrations/214_handover_z_corrections.sql'), 'utf8'));
  assert.deepEqual(await readApplicationFingerprint(executor), initial, 'NO_DATA_CHANGES');
  await sql(`INSERT INTO auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
    VALUES(${q(id(998))},${q(owner)},'Local Z MFA','totp','verified',NOW(),NOW(),'z214-local-fixture');`);
  const roles = ['owner', 'admin', 'manager', 'accountant', 'sales', 'cashier', 'warehouse_keeper'];
  for (const [index, role] of roles.entries()) {
    await sql(`INSERT INTO auth.users(id,aud,role,email) VALUES(${q(id(700 + index))},'authenticated','authenticated',${q(`z-${role}@example.test`)});
      INSERT INTO profiles(id,full_name,is_active) VALUES(${q(id(700 + index))},${q('اختبار ' + role)},true);
      INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;
      INSERT INTO user_roles(user_id,role_id) SELECT ${q(id(700 + index))},id FROM roles WHERE code=${q(role)};`);
  }
  await sql(`INSERT INTO auth.users(id,aud,role,email) VALUES(${q(id(720))},'authenticated','authenticated','z-no-role@example.test');
    INSERT INTO profiles(id,full_name,is_active) VALUES(${q(id(720))},'بلا دور',true);
    INSERT INTO auth.users(id,aud,role,email) VALUES(${q(id(721))},'authenticated','authenticated','z-inactive@example.test');
    INSERT INTO profiles(id,full_name,is_active) VALUES(${q(id(721))},'مالك غير نشط',false);
    INSERT INTO user_roles(user_id,role_id) SELECT ${q(id(721))},id FROM roles WHERE code='owner';`);
  for (const [index, status] of ['open', 'closed', 'cancelled', 'reversed'].entries()) {
    stage = 'state ' + status;
    const branch = id(750 + index);
    await sql(`INSERT INTO branches(id,code,name_ar,is_active) VALUES(${q(branch)},${q('ZSHIFT-' + status)},'ورديات الحارس',true);`);
    const opened = await rpc(`open_cash_shift(${q(branch)},10000)`), shift = opened.id;
    assert.ok(shift, JSON.stringify(opened));
    if (status === 'closed') await rpc(`close_cash_shift(${q(shift)},10000,NULL)`);
    if (status === 'cancelled') await rpc(`cancel_empty_cash_shift(${q(shift)},'إلغاء وردية اختبار الحارس')`);
    if (status === 'reversed') {
      await rpc(`create_operational_expense(${q(branch)},'اختبار','مصروف لعكس وردية الاختبار',100,'cash',NULL)`);
      await rpc(`reverse_cash_shift_with_operations(${q(shift)},'عكس وردية اختبار الحارس','z214-shift-reversal-00000001')`);
    }
    assert.equal(await json(`SELECT to_jsonb(status) FROM cash_shifts WHERE id=${q(shift)};`), status);
    const call = `get_cash_shift_display_summary(${q(shift)})`;
    const before = await readApplicationFingerprint(executor);
    const permitted = await rpc(call);
    assert.equal(permitted.status, status);
    for (let i = 0; i < 5; i++) assert.equal((await rpc(call, id(700 + i))).status, status);
    // Keep the central enrolled-MFA rollout policy: no-factor AAL1 is still allowed.
    assert.equal((await rpc(call, id(700), 'aal1')).status, status);
    const denied = [
      {uid: id(720), aal: 'aal2', role: 'authenticated', error: /ليس لديك صلاحية/},
      {uid: id(721), aal: 'aal2', role: 'authenticated', error: /ليس لديك صلاحية/},
      {uid: owner, aal: 'aal1', role: 'authenticated', error: /المصادقة الثنائية/},
      {uid: id(705), aal: 'aal2', role: 'authenticated', error: /ليس لديك صلاحية/},
      {uid: id(706), aal: 'aal2', role: 'authenticated', error: /ليس لديك صلاحية/},
      {uid: owner, aal: 'aal2', role: 'anon', error: /permission denied/},
      {uid: owner, aal: 'aal2', role: 'service_role', error: /permission denied/},
    ];
    for (const actor of denied) {
      const result = await executeInput(executor, auth('SELECT public.' + call + ';', actor.uid, actor.aal, actor.role));
      assert.notEqual(result.code, 0, 'DENIAL_REQUIRED');
      assert.match(result.stderr, actor.error);
      // A missing UUID must not disclose existence before the same role/MFA rejection.
      const absent = await executeInput(executor, auth(`SELECT public.get_cash_shift_display_summary(${q(id(999))});`, actor.uid, actor.aal, actor.role));
      assert.notEqual(absent.code, 0);
      assert.match(absent.stderr, actor.error);
    }
    assert.deepEqual(await readApplicationFingerprint(executor), before, 'ALL_READS_AND_DENIALS_ZERO_WRITES');
    report.cases.push({status, allowedReads: 7, deniedReads: denied.length * 2, unchangedFingerprint: true});
    console.log(JSON.stringify(report.cases.at(-1)));
  }
  report.ok = true;
} catch (error) {
  report.ok = false; report.stage = stage; report.error = error.message; process.exitCode = 1;
} finally {
  if (local) await exec(process.execPath, [path.join(root, 'node_modules/supabase/dist/supabase.js'), 'stop', '--no-backup', '--workdir', local], {cwd: root, windowsHide: true});
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ok: report.ok, stage, error: report.error, output, cases: report.cases.length}));
}
