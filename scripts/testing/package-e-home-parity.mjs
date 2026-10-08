import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Disposable DB only. Explicit source definitions, never catalog text patching.
// Both reads share one transaction/NOW: not even generatedAt is excluded.
export async function homeParity({sql,root,owner,label}) {
  const source=await readFile(path.join(root,'supabase/migrations/131_phase6_operational_report_readers.sql'),'utf8');
  const facts=source.slice(source.indexOf('CREATE FUNCTION public.phase6_financial_facts_internal('),
    source.indexOf('REVOKE ALL ON FUNCTION public.phase6_financial_facts_internal('))
    .replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
  assert.ok(facts.endsWith('\n\n')||facts.trim().endsWith('$$;'));
  const migration=await readFile(path.join(root,'supabase/migrations/134_package_e_read_performance.sql'),'utf8');
  assert.equal((migration.match(/^BEGIN;$/gmu)??[]).length,1);
  const indexes=[...migration.matchAll(/CREATE INDEX (\w+)\s+ON public\.(\w+)\((\w+)\);/gu)];
  assert.deepEqual(indexes.map(m=>m.slice(1)),[
    ['idx_sales_return_items_operation_id','sales_return_items','operation_id'],
    ['idx_sales_replacement_items_operation_id','sales_replacement_items','operation_id'],
  ]);
  const indexSql=indexes.map(m=>m[0]).join('\n');
  const definition=migration.replace(/^BEGIN;\r?\n/mu,'').replace(/^COMMIT;\s*$/mu,'')
    .replace(/CREATE INDEX (\w+)\s+ON public\.(\w+)\((\w+)\);/gu,'');
  const unavailable=`CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal(
    p_branch_id UUID,p_period_start TIMESTAMPTZ,p_period_end TIMESTAMPTZ,p_timezone TEXT,p_verify_evidence BOOLEAN)
    RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
    AS $$ BEGIN RAISE EXCEPTION 'E2_ISOLATED_UNAVAILABLE_PROBE'; END $$;`;
  const capture=(key)=>`SET LOCAL ROLE authenticated;
    INSERT INTO e2_home_parity VALUES('${key}',public.get_home_dashboard());RESET ROLE;`;
  const raw=await sql(`BEGIN;
    DO $$ BEGIN PERFORM set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated","aal":"aal2"}',true);END $$;
    CREATE TEMP TABLE e2_home_parity(mode text PRIMARY KEY,result jsonb) ON COMMIT DROP;
    CREATE TEMP TABLE e2_baseline_timing(started_at timestamptz,first_attempt_ms numeric,
      extended_capture_ms numeric,extended_timeout_used boolean DEFAULT false) ON COMMIT DROP;
    GRANT SELECT,INSERT ON e2_home_parity TO authenticated;
    ${indexSql}
    INSERT INTO e2_baseline_timing(started_at) VALUES(clock_timestamp());
    SAVEPOINT baseline_capture;
    SET LOCAL ROLE authenticated;
    \\set ON_ERROR_STOP off
    INSERT INTO e2_home_parity VALUES('before-available',public.get_home_dashboard());
    \\if :ERROR
      \\set baseline_error :SQLSTATE
      ROLLBACK TO SAVEPOINT baseline_capture;
      \\set ON_ERROR_STOP on
      RESET ROLE;
      SELECT :'baseline_error'='57014' AS baseline_timeout \\gset
      \\if :baseline_timeout
        UPDATE e2_baseline_timing SET first_attempt_ms=EXTRACT(epoch FROM clock_timestamp()-started_at)*1000,
          started_at=clock_timestamp(),extended_timeout_used=true;
        -- Owner exception: strict baseline JSON capture ONLY, disposable TX.
        SET LOCAL statement_timeout='15min';
        ${capture('before-available')}
        SET LOCAL statement_timeout='60s';
        UPDATE e2_baseline_timing SET extended_capture_ms=EXTRACT(epoch FROM clock_timestamp()-started_at)*1000;
      \\else
        \\quit 3
      \\endif
    \\else
      \\set ON_ERROR_STOP on
      RESET ROLE;
      UPDATE e2_baseline_timing SET first_attempt_ms=EXTRACT(epoch FROM clock_timestamp()-started_at)*1000;
    \\endif
    RELEASE SAVEPOINT baseline_capture;
    ${unavailable}
    ${capture('before-unavailable')}
    ${facts}
    ${definition}
    ${capture('after-available')}
    ${unavailable}
    ${capture('after-unavailable')}
    DO $$ DECLARE v_mode text;old_result jsonb;new_result jsonb;BEGIN
      FOREACH v_mode IN ARRAY ARRAY['available','unavailable'] LOOP
        SELECT result INTO STRICT old_result FROM e2_home_parity WHERE e2_home_parity.mode='before-'||v_mode;
        SELECT result INTO STRICT new_result FROM e2_home_parity WHERE e2_home_parity.mode='after-'||v_mode;
        IF old_result->>'financialFactsStatus' IS DISTINCT FROM v_mode OR new_result->>'financialFactsStatus' IS DISTINCT FROM v_mode
          OR old_result::text IS DISTINCT FROM new_result::text THEN
          RAISE EXCEPTION 'E2_HOME_JSON_MISMATCH mode=% before=% after=%',v_mode,old_result,new_result;
        END IF;
      END LOOP;
    END $$;
    SELECT jsonb_build_object('label','${label}','literalJsonEquality',true,'excludedTimeFields','[]'::jsonb,
      'sameTransactionNow',true,'sameApprovedIndexes',true,
      'baselineCapture',(SELECT jsonb_build_object('firstAttemptMs',first_attempt_ms,
        'extendedTimeoutUsed',extended_timeout_used,'extendedCaptureMs',extended_capture_ms,
        'performanceEvidence',false) FROM e2_baseline_timing),
      'modes',jsonb_agg(jsonb_build_object('mode',mode,'sha256',
        encode(extensions.digest(result::text,'sha256'),'hex')) ORDER BY mode)) FROM e2_home_parity;
    ROLLBACK;`);
  const proof=JSON.parse((typeof raw==='string'?raw:raw.out).trim().split(/\r?\n/u).at(-1));
  assert.equal(proof.literalJsonEquality,true);assert.equal(proof.modes.length,4);
  assert.equal(proof.sameApprovedIndexes,true);assert.equal(proof.baselineCapture.performanceEvidence,false);
  console.log(JSON.stringify({stage:'home before133/after134 literal parity',...proof}));
  return proof;
}
