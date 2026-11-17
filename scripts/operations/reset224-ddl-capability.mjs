// Admission only: no probe DDL, no grants and no attempt to load an absent library.
// The policy hook checks the CURRENT role name, not inherited policy grants.
// Supabase supautils v3.4.0 src/policy_grants.c:132-171 and supautils.c policy hooks.
import assert from 'node:assert/strict';
import {executeResetInput} from './reset214-io.mjs';

export const reset224DdlCapabilitySql=`BEGIN READ ONLY;
WITH actor AS (SELECT oid,rolname,rolsuper FROM pg_roles WHERE rolname=current_user),
target AS (SELECT oid,relowner FROM pg_class WHERE oid=to_regclass('storage.objects')),
settings AS (SELECT name,setting FROM pg_settings WHERE name IN('supautils.policy_grants','supautils.superuser')),
owned AS (
 SELECT n.nspname||'.'||c.relname AS identity,c.relowner AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','sales_lite1','sales_lite2','sales_lite3') AND c.relkind IN('r','p','v','m','f','S')
 UNION ALL SELECT n.nspname||'.'||p.proname,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','sales_lite1','sales_lite2','sales_lite3')
 UNION ALL SELECT n.nspname||'.'||t.typname,t.typowner FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname IN('public','sales_lite1','sales_lite2','sales_lite3') AND t.typtype IN('e','d','c') AND t.typelem=0
 UNION ALL SELECT nspname,nspowner FROM pg_namespace WHERE nspname IN('sales_lite1','sales_lite2','sales_lite3')
), checks AS (
 SELECT 'actor' AS name,current_user='postgres' AND session_user='postgres' AS ok
 UNION ALL SELECT 'storage_policy',EXISTS(SELECT 1 FROM actor a CROSS JOIN target t WHERE
  a.rolsuper OR pg_has_role(a.oid,t.relowner,'USAGE') OR (
   coalesce((SELECT setting::jsonb->a.rolname FROM settings WHERE name='supautils.policy_grants'),'[]'::jsonb) ? 'storage.objects'
   AND EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolsuper AND r.rolname=(SELECT setting FROM settings WHERE name='supautils.superuser'))))
 UNION ALL SELECT 'database_create',has_database_privilege(current_user,current_database(),'CREATE')
 UNION ALL SELECT 'public_create',has_schema_privilege(current_user,'public','CREATE') AND has_schema_privilege(current_user,'public','USAGE')
 UNION ALL SELECT 'rebuild_ownership',NOT EXISTS(SELECT 1 FROM owned WHERE NOT pg_has_role(current_user,owner,'USAGE'))
 UNION ALL SELECT 'publication',EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND pg_has_role(current_user,pubowner,'USAGE'))
 UNION ALL SELECT 'platform_extensions',(SELECT count(*)=4 FROM pg_extension WHERE extname IN('pgcrypto','pg_net','pg_cron','supabase_vault'))
)
SELECT jsonb_build_object('actor',current_user,'sessionActor',session_user,
 'storageOwner',(SELECT pg_get_userbyid(relowner) FROM target),
 'checks',(SELECT jsonb_object_agg(name,ok ORDER BY name) FROM checks),
 'deniedObjects',(SELECT coalesce(jsonb_agg(identity ORDER BY identity),'[]'::jsonb) FROM owned WHERE NOT pg_has_role(current_user,owner,'USAGE')));
ROLLBACK;`;
const checks=['actor','storage_policy','database_create','public_create','rebuild_ownership','publication','platform_extensions'];
export const reset224DdlArabicReason='توقّف قبل التصفير: دور التنفيذ لا يملك قدرة إدارة سياسات Storage أو إعادة بناء القاعدة. لم تبدأ أي كتابة. راجع إعدادات الدور وsupautils؛ لا تمنح ملكية أو صلاحيات لتجاوز الفحص.';
export function assertReset224DdlCapability(value){
 assert.ok(value&&typeof value==='object','RESET224_DDL_CAPABILITY_UNVERIFIED');
 assert.deepEqual(Object.keys(value.checks??{}).sort(),[...checks].sort(),'RESET224_DDL_CAPABILITY_UNVERIFIED');
 assert.ok(checks.every(name=>value.checks[name]===true),'RESET224_DDL_CAPABILITY_REQUIRED');
 assert.deepEqual(value.deniedObjects,[],'RESET224_DDL_CAPABILITY_REQUIRED');
 return value;
}
export async function verifyReset224DdlCapability(executor){
 const result=await executeResetInput(executor,reset224DdlCapabilitySql);
 assert.equal(result.code,0,'RESET224_DDL_CAPABILITY_UNVERIFIED');
 let value;try{value=JSON.parse(result.stdout.trim());}catch{throw Error('RESET224_DDL_CAPABILITY_UNVERIFIED');}
 return assertReset224DdlCapability(value);
}
