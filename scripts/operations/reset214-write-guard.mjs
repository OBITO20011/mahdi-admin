// Temporary reset tooling,removed before final full catalog comparison.
// Committed non-tool writes leave a sticky bit even if their rows are deleted.
import assert from 'node:assert/strict';
import {executeResetInput as executeInput} from './reset214-io.mjs';
import {sqlLiteral as q,cleanSeedCounts} from './trial-reset-core.mjs';
import {sha256} from '../testing/maintenance-db-contract.mjs';
export const guardSchema='reset214_guard';
const guardTrigger='reset214_owner_write_evidence';
const truncateTrigger='reset214_owner_truncate_evidence';
export const publicFingerprintSql=`DO $f$ DECLARE r record;n bigint;h text;v jsonb='{}';BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
 EXECUTE format('SELECT count(*),md5(COALESCE(string_agg(to_jsonb(t)::text,E''\\n'' ORDER BY to_jsonb(t)::text COLLATE "C"),'''')) FROM public.%I t',r.tablename) INTO n,h;
 v=v||jsonb_build_object(r.tablename,jsonb_build_object('rows',n,'hash',h));END LOOP;
 RAISE NOTICE 'RESET214_FINGERPRINT:%',v;END$f$;`;
export async function publicFingerprint(executor){
 const r=await executeInput(executor,publicFingerprintSql);assert.equal(r.code,0,'RESET214_FINGERPRINT_READ_FAILED');
 const match=r.stderr.match(/RESET214_FINGERPRINT:(\{[^\r\n]*\})/u);assert.ok(match,'RESET214_FINGERPRINT_MISSING');return JSON.parse(match[1]);
}
export function writerExecutor(executor,token){
 assert.match(token,/^[a-f0-9-]{36}$/u,'RESET214_WRITER_ID');
 if(executor.localOnly===true&&typeof executor.localExecute==='function')return {...executor,reset214Writer:token};
 // psql -c precedes stdin on that same connection. Docker executor has -c input
 // available too;the caller uses this only for the direct psql owner executor.
 return {...executor,args:[...executor.args,'-c',`SET reset214.writer=${q(token)};`,'-f','-']};
}
export const guardCreateSql=(token,attempt)=>`BEGIN;
 CREATE SCHEMA reset214_guard AUTHORIZATION postgres;REVOKE ALL ON SCHEMA reset214_guard FROM PUBLIC,anon,authenticated,service_role;
 CREATE TABLE reset214_guard.state(id bool PRIMARY KEY DEFAULT true CHECK(id),attempt text NOT NULL,writer_hash text NOT NULL,foreign_writes bigint NOT NULL DEFAULT 0);
 REVOKE ALL ON reset214_guard.state FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO reset214_guard.state(id,attempt,writer_hash) VALUES(true,${q(attempt)},${q(sha256(token))});
 CREATE FUNCTION reset214_guard.observe() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $g$
 BEGIN IF encode(sha256(convert_to(COALESCE(current_setting('reset214.writer',true),''),'UTF8')),'hex') IS DISTINCT FROM (SELECT writer_hash FROM reset214_guard.state WHERE id) THEN
 UPDATE reset214_guard.state SET foreign_writes=foreign_writes+1 WHERE id;END IF;RETURN NULL;END$g$;
 REVOKE ALL ON FUNCTION reset214_guard.observe() FROM PUBLIC,anon,authenticated,service_role;
 COMMIT;`;
export const attachGuardSql=`DO $attach$ DECLARE r record;BEGIN
 FOR r IN SELECT c.oid,c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN('r','p')
 AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='${guardTrigger}') LOOP
 EXECUTE format('CREATE TRIGGER ${guardTrigger} AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION reset214_guard.observe()',r.relname);
 EXECUTE format('CREATE TRIGGER ${truncateTrigger} AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION reset214_guard.observe()',r.relname);END LOOP;END$attach$;`;
export const removeGuardSql=`BEGIN;DO $detach$ DECLARE r record;BEGIN
 FOR r IN SELECT c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND t.tgname IN('${guardTrigger}','${truncateTrigger}') LOOP
 EXECUTE format('DROP TRIGGER %I ON public.%I',r.tgname,r.relname);END LOOP;END$detach$;DROP SCHEMA reset214_guard CASCADE;COMMIT;`;
// Close the read-check/drop race on existing tables in the SAME transaction.
export const lockAndCheckGuardSql=`DO $fence$ DECLARE r record;BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
 EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',r.tablename);END LOOP;
 IF (SELECT foreign_writes FROM reset214_guard.state WHERE id) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'RESET214_REAL_WRITES_DETECTED';END IF;END$fence$;`;
export function withoutResetGuard(catalog){
 const copy=structuredClone(catalog);
 for(const [section,rows] of Object.entries(copy))copy[section]=rows.filter(r=>r.schema!==guardSchema&&!(section==='schemas'&&r.name===guardSchema)&&!(section==='triggers'&&[guardTrigger,truncateTrigger].includes(r.name)));
 return copy;
}
export async function assertNoForeignWrites(executor,snapshot,{guardRequired=true}={}){
 const read=async s=>{const r=await executeInput(executor,s);assert.equal(r.code,0,'RESET214_RESUME_GUARD_READ_FAILED');return r.stdout.trim();};
 const exists=await read("SELECT to_regclass('reset214_guard.state') IS NOT NULL;");
 if(exists==='t'){
  const state=JSON.parse(await read("SELECT jsonb_build_object('attempt',attempt,'hash',writer_hash,'writes',foreign_writes::text) FROM reset214_guard.state WHERE id;"));
  assert.equal(state.attempt,snapshot.attemptId,'RESET214_RESUME_GUARD_MISMATCH');assert.equal(state.hash,sha256(snapshot.writerToken),'RESET214_RESUME_GUARD_MISMATCH');
  assert.equal(state.writes,'0','RESET214_REAL_WRITES_DETECTED');
 }else assert.equal(guardRequired,false,'RESET214_RESUME_GUARD_MISSING');
 const observed=await publicFingerprint(executor);
 if(JSON.stringify(observed)===JSON.stringify(snapshot.initialFingerprint))return {state:'original-trial-data-unchanged'};
 // After public has been dropped,only seed/settings/retained identity rows may
 // exist. Unknown or new business rows fail closed,including new future tables.
 const metadata=new Set([...Object.keys(cleanSeedCounts),'profiles','user_roles']);
 // Literal008 seeds these TWO sample suppliers;literal034 deletes them. This
 // is a named prefix-only admission,not permission to retain supplier rows.
 if(observed.suppliers?.rows){
  const history=await read("SELECT COALESCE(max(version),'000') FROM supabase_migrations.schema_migrations;");
  assert.ok(history<'034','RESET214_REAL_WRITES_DETECTED');assert.equal(observed.suppliers.rows,2,'RESET214_REAL_WRITES_DETECTED');
  assert.equal(await read(`SELECT count(*) FROM public.suppliers WHERE is_active AND notes IS NULL AND whatsapp IS NULL AND
   (company_name,contact_person,phone,email,address,tax_number) IN
   (('شركة الأردن التجارية المحدودة','أحمد محمود','0791234567','info@jordan-trade.jo','عمان - شارع مكة','102938475'),
    ('مجموعة البركة للتوريدات العمومية','خالد النجار','0788765432','sales@albaraka.jo','الزرقاء - المنطقة الحرة','987654321'));`),'2','RESET214_REAL_WRITES_DETECTED');
  metadata.add('suppliers');
 }
 for(const [table,value] of Object.entries(observed))if(!metadata.has(table))assert.equal(value.rows,0,'RESET214_REAL_WRITES_DETECTED');
 if(observed.audit_logs?.rows){
  assert.equal(observed.audit_logs.rows,1,'RESET214_REAL_WRITES_DETECTED');
  assert.equal(await read("SELECT count(*) FROM public.audit_logs WHERE action='PRELAUNCH_TEST_DATA_CLEANUP' AND user_id IS NULL AND entity_name='system' AND entity_id IS NULL;"),'1','RESET214_REAL_WRITES_DETECTED');
 }
 return {state:'no-business-data-in-rebuild'};
}
