import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Disposable rollback-only DDL; literal JSON including every timestamp.
export async function reportParity({sql,root,owner,branch,label}) {
  const migration=await readFile(path.join(root,'supabase/migrations/134_package_e_read_performance.sql'),'utf8');
  const indexes=[...migration.matchAll(/CREATE INDEX (\w+)\s+ON public\.(\w+)\((\w+)\);/gu)];
  assert.equal(indexes.length,2);
  const definition=migration.replace(/^BEGIN;\r?\n/mu,'').replace(/^COMMIT;\s*$/mu,'')
    .replace(/CREATE INDEX (\w+)\s+ON public\.(\w+)\((\w+)\);/gu,'');
  const today="(NOW() AT TIME ZONE 'Asia/Amman')::date";
  const cases=[
    {name:'daily-report',role:'authenticated',call:`get_operational_business_report('${branch}',${today},${today})`},
    {name:'monthly-report',role:'authenticated',call:`get_operational_business_report('${branch}',date_trunc('month',NOW() AT TIME ZONE 'Asia/Amman')::date,${today})`},
    {name:'daily-summary',role:'service_role',call:`build_business_summary('daily',${today},${today},NOW())`},
  ];
  const capture=mode=>cases.map(c=>`SET LOCAL ROLE ${c.role};
    INSERT INTO e2_report_parity VALUES('${mode}','${c.name}',public.${c.call});RESET ROLE;`).join('\n');
  const raw=await sql(`BEGIN;
    SELECT set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated","aal":"aal2"}',true);
    CREATE TEMP TABLE e2_report_parity(mode text,name text,result jsonb,PRIMARY KEY(mode,name)) ON COMMIT DROP;
    GRANT INSERT ON e2_report_parity TO authenticated,service_role;
    ${indexes.map(m=>m[0]).join('\n')}
    ${capture('before')}
    ${definition}
    ${capture('after')}
    DO $$ DECLARE c record;BEGIN
      FOR c IN SELECT a.name,a.result old_result,b.result new_result
        FROM e2_report_parity a JOIN e2_report_parity b USING(name)
        WHERE a.mode='before' AND b.mode='after'
      LOOP
        IF c.old_result::text IS DISTINCT FROM c.new_result::text THEN
          RAISE EXCEPTION 'E2_REPORT_JSON_MISMATCH name=% before=% after=%',c.name,c.old_result,c.new_result;
        END IF;
      END LOOP;
    END $$;
    SELECT jsonb_build_object('label','${label}','literalJsonEquality',true,'excludedTimeFields','[]'::jsonb,
      'sameTransactionNow',true,'sameApprovedIndexes',true,
      'modes',jsonb_agg(jsonb_build_object('name',name,'mode',mode,'sha256',
        encode(extensions.digest(result::text,'sha256'),'hex')) ORDER BY name,mode))
      FROM e2_report_parity;
    ROLLBACK;`);
  const proof=JSON.parse((typeof raw==='string'?raw:raw.out).trim().split(/\r?\n/u).at(-1));
  assert.equal(proof.modes.length,6);assert.equal(proof.literalJsonEquality,true);
  console.log(JSON.stringify({stage:'report before133/after134 literal parity',...proof}));
  return proof;
}
