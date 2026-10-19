import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertCleanCounts,assertExternalDependents,cleanSeedCounts,dropPublicSql,preservedStateSql,restoreOwnerSql,restoreResetAcl,canonicalResetAcl,resetComparisonDates,uuid,restoreMainWarehouseSql,assertResetCeiling} from '../scripts/operations/trial-reset-core.mjs';
import {resetArguments} from '../scripts/operations/frankfurt-trial-reset.mjs';
import {localTotp} from '../scripts/testing/local-totp.mjs';

test('local TOTP helper matches the RFC6238 public test vector',()=>{
 assert.equal(localTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',59000),'287082');
 assert.throws(()=>localTotp('invalid!'));
});
test('reset uses actual capture days,not the older reference day for its before/after rebuild proof',()=>{
 assert.deepEqual(resetComparisonDates('2026-10-15','2026-10-17','2026-10-18'),{
  admission:{beforeBuildDate:'2026-10-15',afterBuildDate:'2026-10-17'},rebuild:{beforeBuildDate:'2026-10-17',afterBuildDate:'2026-10-18'}});
 assert.throws(()=>resetComparisonDates('bad','2026-10-17'));
});

test('trial reset is offline by default and requires unambiguous explicit apply plus owner UUID',()=>{
 assert.equal(resetArguments([]).apply,false);assert.equal(resetArguments(['--dry-run']).apply,false);
 assert.throws(()=>resetArguments(['--apply']),/OWNER_UUID_REQUIRED/u);
 assert.throws(()=>resetArguments(['--apply','--dry-run']));
 assert.throws(()=>resetArguments(['--workdir','one','--workdir','two']),/DUPLICATE_RESET_OPTION/u);
 assert.throws(()=>resetArguments(['--owner-id',"';DROP DATABASE postgres;--"]));
 const source=readFileSync('scripts/operations/frankfurt-trial-reset.mjs','utf8');
 assert.ok(source.indexOf('if(!options.apply)')<source.indexOf('await ownerPassword()'));
 assert.match(source,/connectionFromLink/u);assert.match(source,/OLD_BACKUP_LINK_CHANGED/u);
 assert.match(source,/storage','rm'/u);assert.match(source,/ss:\/\/\/product-images\//u);
 assert.match(source,/'--experimental','--linked','--yes'/u,'only after explicit owner confirmation,otherwise CLI exits0 without deleting');
 assert.doesNotMatch(source,/DELETE FROM storage\./iu,'physical images must use Storage API');
});

test('trial reset drops public only,never bypasses business append-only guards',()=>{
 assert.match(dropPublicSql,/DROP %s public\.%I CASCADE/u);
 assert.doesNotMatch(dropPublicSql,/DELETE|TRUNCATE|DISABLE TRIGGER|session_replication_role|DROP SCHEMA/iu);
 const source=readFileSync('scripts/operations/trial-reset-core.mjs','utf8');
 assert.doesNotMatch(source,/ALTER TABLE public\.orders ENABLE TRIGGER/u,'no brief notification activation window');
 assert.match(source,/resetUnits\(root,reference\)/u);assert.match(source,/await repair\(version\)/u);
 assert.match(source,/PRESERVED_AUTH_VAULT_BUCKET_STATE_CHANGED/u);
});
test('reset restores the exact admitted creation ACL including service_role,not a blanket grant',()=>{
 const row={schema:'public',name:'orders',kind:'r',owner:'postgres',rls:true,acl:['postgres=arwdDxtm/postgres','service_role=Dxtm/postgres','authenticated=r/postgres']};
 const actual={...row,acl:['postgres=arwdDxtm/postgres','anon=r/postgres']};
 const commands=restoreResetAcl({tables:[row],functions:[]},{tables:[actual],functions:[]});
 assert.ok(commands.includes('REVOKE SELECT ON TABLE public."orders" FROM "anon";'));
 assert.ok(commands.includes('GRANT SELECT ON TABLE public."orders" TO "authenticated";'));
 assert.ok(commands.includes('GRANT TRIGGER ON TABLE public."orders" TO "service_role";'));
 assert.throws(()=>restoreResetAcl({tables:[row],functions:[]},{tables:[{...actual,rls:false}],functions:[]}),/RESET_NON_ACL_OBJECT_DRIFT/u);
 assert.throws(()=>restoreResetAcl({tables:[{...row,acl:['service_role=r/supabase_admin']}],functions:[]},{tables:[{...row,acl:['service_role=r/supabase_admin']}],functions:[]}),/RESET_ACL_GRANTOR/u);
 const source=readFileSync('scripts/operations/trial-reset-core.mjs','utf8');assert.ok(source.indexOf('restoreResetAcl(before,before)')<source.indexOf('await emptyStorage()'));
 assert.deepEqual(canonicalResetAcl({tables:[row]}),canonicalResetAcl({tables:[{...row,acl:[...row.acl].reverse()}]}));
});
test('public cascade refuses unknown platform dependencies before destruction',()=>{
 assert.doesNotThrow(()=>assertExternalDependents([{class:'pg_policy',schema:'storage',policy:'ERP staff can upload own product images',relation:'storage.objects'}]));
 assert.throws(()=>assertExternalDependents([{class:'pg_proc',schema:'auth',description:'function auth.custom_hook()'}]),/UNREVIEWED_EXTERNAL_DROP_DEPENDENT/u);
});
test('every public table is checked;new nonempty tables and leftover business data fail',()=>{
 const good={...cleanSeedCounts,roles:1,profiles:1,user_roles:1,orders:0,product_cost_corrections:0};
 assert.doesNotThrow(()=>assertCleanCounts(good));
 assert.throws(()=>assertCleanCounts({...good,orders:1}),/RESET_ROW_COUNT:orders/u);
 assert.throws(()=>assertCleanCounts({...good,future_append_only:1}),/RESET_ROW_COUNT:future_append_only/u);
 assert.throws(()=>assertCleanCounts({...good,audit_logs:2}),/RESET_ROW_COUNT:audit_logs/u);
 assert.throws(()=>assertCleanCounts({...good,profiles:2}),/RESET_ROW_COUNT:profiles/u);
});
test('owner binding uses a UUID and explicit seeded branch code,not role names supplied by a caller',()=>{
 const id='92600000-0000-4000-8000-000000000001';
 assert.throws(()=>uuid("';DROP SCHEMA auth;--"));
 const p={id,full_name:'مالك',phone:null,avatar_url:'https://example.test/trial.png',is_active:true,created_at:'2026-10-15Z',updated_at:'2026-10-15Z',job_title:null};
 const sql=restoreOwnerSql({profile:p,branch:{id,code:'OWNER-BRANCH'},roles:['owner']});
 assert.match(sql,/jsonb_populate_record/u);assert.match(sql,/code='owner'/u);assert.doesNotMatch(sql,/trial\.png/u);
 assert.throws(()=>restoreOwnerSql({profile:p,branch:null,roles:['cashier']}));
 assert.doesNotMatch(preservedStateSql(id),/decrypted_secrets/u,'no Vault plaintext leaves PostgreSQL');
});

test('reset admits frozen182/199/200/201 and current202 only and preserves the named main warehouse,not trial locations',()=>{
 assert.equal(assertResetCeiling({migrationCeiling:199}),161);
 assert.equal(assertResetCeiling({migrationCeiling:200}),162);
 assert.equal(assertResetCeiling({migrationCeiling:201}),163);
 assert.equal(assertResetCeiling({migrationCeiling:202}),164);
 for(const migrationCeiling of [138,198,203])assert.throws(()=>assertResetCeiling({migrationCeiling}));
 const id='92600000-0000-4000-8000-000000000001';
 const record={branch:{id,code:'BR-MAIN',name_ar:'الفرع الرئيسي',is_active:true},warehouse:{id,branch_id:id,code:'WH-MAIN',name_ar:'اسم عدله المالك',is_active:true}};
 assert.match(restoreMainWarehouseSql(record),/jsonb_populate_record\(NULL::public.warehouses/u);
 assert.throws(()=>restoreMainWarehouseSql({...record,warehouse:{...record.warehouse,branch_id:'different'}}));
 const counts={...cleanSeedCounts,roles:1,profiles:1,user_roles:1,branches:1,warehouses:1};
 assert.doesNotThrow(()=>assertCleanCounts(counts,true,true,true));
 assert.throws(()=>assertCleanCounts({...counts,warehouses:2},true,true,true),/RESET_ROW_COUNT:warehouses/u);
});
