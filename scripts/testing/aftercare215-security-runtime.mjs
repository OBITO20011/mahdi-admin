import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {executeInput} from '../operations/build-empty-supabase.mjs';

export async function verifyInspectedSecurity215(c, pass) {
  const {q, j, id, sql, rpc, setup, key, fail, fingerprint, owner} = c;
  const s = await setup(), request = `preview_inspected_sales_replacement_v2(${j(s.payload)})`;
  const preview = await rpc(request), k = key();
  const writer = (payload = s.payload, seal = preview.previewFingerprint, identity = k) =>
    `settle_inspected_sales_replacement_v2(${j(payload)},${q(identity)},${q(seal)})`;
  const inspectPrivateKeys = value => {
    if (!value || typeof value !== 'object') return;
    for (const [name, v] of Object.entries(value)) {
      assert.ok(!/cost|wac|profit|recoveryInMinor|heldInMinor/i.test(name), `PRIVATE_VALUE_LEAK:${name}`);
      inspectPrivateKeys(v);
    }
  };
  for (const [n, role] of ['admin', 'manager', 'warehouse_keeper', 'cashier', 'viewer', 'none'].entries()) {
    const uid = id(215100 + n);
    await sql(`INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES(${q(uid)},'authenticated','authenticated',${q('tb215-' + role + '@example.test')},'{}','{}');INSERT INTO public.profiles(id,full_name,is_active) VALUES(${q(uid)},${q(role)},true);`);
    if (role !== 'none') await sql(`INSERT INTO public.roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;INSERT INTO public.user_roles(user_id,role_id) SELECT ${q(uid)},id FROM public.roles WHERE code=${q(role)};`);
    if (role === 'admin') {
      const p = await rpc(request, uid); inspectPrivateKeys(p);
      const result = await rpc(writer(s.payload, p.previewFingerprint, key()), uid); inspectPrivateKeys(result);
      const held = await setup({supplierHeld: true});
      await fail(`preview_inspected_sales_replacement_v2(${j(held.payload)})`, /OWNER_ONLY|ROLE_DENIED/, uid);
    } else {
      await fail(request, /صلاحية|permission|ROLE_DENIED|غير مصرح/i, uid);
      await fail(writer(), /صلاحية|permission|ROLE_DENIED|غير مصرح/i, uid);
    }
    for (const fn of ['tb215_canonical_inspection_internal', 'tb215_prepare_inspection_internal']) {
      await fail(`${fn}(${j(s.payload)})`, /permission denied/, uid);
    }
  }
  pass('all staff/no-role callers: admin quantitative preview/save has no owner financial fields; supplier choice owner-only; every private helper denied');
  for (const role of ['anon', 'service_role']) {
    await fail(request, /permission denied/, owner, role);
    await fail(writer(), /permission denied/, owner, role);
  }
  await sql(`INSERT INTO auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret) VALUES(${q(id(215199))},${q(owner)},'Local215 enrollment','totp','verified',NOW(),NOW(),'local215-test-factor');`);
  await fail(request, /المصادقة الثنائية/, owner, 'authenticated', 'aal1');
  await fail(writer(), /المصادقة الثنائية/, owner, 'authenticated', 'aal1');
  await sql(`UPDATE public.profiles SET is_active=false WHERE id=${q(owner)};`);
  try { await fail(writer(), /صلاحية|permission|ROLE_DENIED|غير مصرح/i); }
  finally { await sql(`UPDATE public.profiles SET is_active=true WHERE id=${q(owner)};`); }
  pass('anon/service role grants absent; enrolled owner AAL1 and inactive owner denied before reads/writes');

  // Hold a real successful transaction open, prove the independent contender
  // is blocked by PostgreSQL, then release it. No timing-only race assertions.
  const held = async call => {
    const child = spawn('docker', ['exec', '-i', 'supabase_db_nawasrah-tb215-test', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '', readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(stdout) : reject(Error(stderr)));
    });
    void done.catch(error => readyReject(error));
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('TB215_HOLDER_READY')) readyResolve(); });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.write(c.auth(`SELECT public.${call};`).replace('COMMIT;', "SELECT 'TB215_HOLDER_READY';") + '\n');
    await ready;
    return async () => { child.stdin.end('COMMIT;\n'); await done; };
  };
  const race = async (first, second) => {
    const release = await held(first);
    let contender;
    try {
      contender = executeInput(c.executor, "SET application_name='tb215-contender';" + c.auth(`SELECT public.${second};`));
      let blocked = false;
      for (let n = 0; n < 100; n++) {
        if (await sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='tb215-contender' AND cardinality(pg_blocking_pids(pid))>0;") === '1') { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(blocked, true, 'INDEPENDENT_POSTGRES_SESSION_MUST_BLOCK');
    } finally { await release(); }
    return contender;
  };
  const concurrent = await setup(), cp = await rpc(`preview_inspected_sales_replacement_v2(${j(concurrent.payload)})`);
  const call = writer(concurrent.payload, cp.previewFingerprint, key());
  const contender = await race(call, call);
  assert.equal(contender.code, 0, contender.stderr);
  const replay = JSON.parse(contender.stdout.trim().split('\n').at(-1)); assert.equal(replay.idempotentReplay, true);
  assert.equal((await c.stock(concurrent.pid)).quantity, 99);
  pass('two real sessions/same identity: contender blocks, exact replay, one issue/restock and one physical-capacity consumption');

  for (const point of ['inventory', 'inspection']) {
    const s = await setup({supplierHeld: true}), p = await rpc(`preview_inspected_sales_replacement_v2(${j(s.payload)})`);
    const table = point === 'inventory' ? 'inventory_movements' : 'aftercare215_inspections';
    await sql(`CREATE FUNCTION public.tb215_test_failure() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN ${point === 'inventory' ? "IF NEW.reference_type='aftercare215_inspection' THEN" : ''} RAISE EXCEPTION 'TB215_INJECTED_FAILURE'; ${point === 'inventory' ? 'END IF;' : ''} RETURN NEW; END $$;CREATE TRIGGER tb215_test_failure BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.tb215_test_failure();`);
    try {
      const before = await fingerprint();
      const r = await executeInput(c.executor, c.auth(`SELECT public.${writer(s.payload, p.previewFingerprint, key())};`));
      assert.notEqual(r.code, 0); assert.match(r.stderr, /TB215_INJECTED_FAILURE/);
      // 113's private mutation stamp is deliberately NEXTVAL/nontransactional.
      // Keep EVERY table and business-number sequence exact; additionally
      // assert the exact expected technical allocations, never reset NEXTVAL.
      const technicalAllocations = point === 'inventory' ? 1 : 2;
      assert.deepEqual(await fingerprint(), {...before, sequences: {...before.sequences,
        inventory_movement_mutation_seq: before.sequences.inventory_movement_mutation_seq + technicalAllocations}},
      'ONLY_EXACT_113_TECHNICAL_STAMPS_MAY_ADVANCE_NO_BUSINESS_EFFECT');
    }
    finally { await sql(`DROP TRIGGER tb215_test_failure ON public.${table};DROP FUNCTION public.tb215_test_failure();`); }
    assert.equal((await c.stock(s.pid)).quantity, 100);
  }
  pass('injected failures roll every table/business-number sequence back; only exact existing113 technical mutation stamps advance1/2, no partial warranty');
  const before = await fingerprint(); await rpc(call); assert.deepEqual(await fingerprint(), before);
}
