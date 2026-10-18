import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {mainWarehouse,mainWarehouseSql} from '../scripts/operations/main-warehouse-core.mjs';
import {mainWarehouseArguments} from '../scripts/operations/frankfurt-main-warehouse.mjs';
const id='92600000-0000-4000-8000-000000000001';
test('main warehouse data bootstrap is narrow,owner-bound,transactional and audited without a schema/Auth change',()=>{
 const sql=mainWarehouseSql(id);
 for(const marker of ['SERIALIZABLE','pg_advisory_xact_lock','FOR UPDATE OF p,u,ur','SHARE ROW EXCLUSIVE MODE',"r.code='owner'",'email_confirmed_at IS NOT NULL',
  'MAIN_WAREHOUSE_OWNER_REQUIRED','MAIN_WAREHOUSE_BRANCH_MISMATCH','MAIN_WAREHOUSE_DIFFERENT_WAREHOUSE','MAIN_WAREHOUSE_BOOTSTRAP',"'WH-MAIN'","'BR-MAIN'",'RETURN;'])assert.ok(sql.includes(marker),marker);
 assert.doesNotMatch(sql,/CREATE |ALTER |GRANT |REVOKE |DELETE FROM|TRUNCATE |UPDATE public\.|INSERT INTO auth\./iu);
 assert.equal((sql.match(/INSERT INTO public\.warehouses/gu)??[]).length,1);
 assert.equal((sql.match(/INSERT INTO public\.audit_logs/gu)??[]).length,1);
 assert.throws(()=>mainWarehouseSql("';DROP SCHEMA public;--"));
 assert.deepEqual(mainWarehouse,{code:'WH-MAIN',name:'المستودع الرئيسي',branchCode:'BR-MAIN',branchName:'الفرع الرئيسي'});
});
test('main warehouse CLI defaults offline,requires explicit actor and rejects ambiguous or secret options',()=>{
 assert.equal(mainWarehouseArguments(['--owner-id',id]).apply,false);
 assert.equal(mainWarehouseArguments(['--dry-run','--owner-id',id]).apply,false);
 assert.equal(mainWarehouseArguments(['--apply','--owner-id',id]).apply,true);
 for(const args of [[],['--apply'],['--apply','--dry-run','--owner-id',id],['--owner-id',id,'--owner-id',id],['--owner-id',id,'--password','forbidden'],['--owner-id','--apply']])assert.throws(()=>mainWarehouseArguments(args));
});
test('current198 reference/history/catalog admission precedes hidden password and any warehouse write',()=>{
 const code=readFileSync('scripts/operations/frankfurt-main-warehouse.mjs','utf8');
 assert.ok(code.indexOf('await readFirstOwner198Reference')<code.indexOf('await ownerPassword()'));
 assert.ok(code.indexOf('if(!options.apply)')<code.indexOf('connectionFromLink(await'));
 assert.ok(code.indexOf('if(!options.apply)')<code.indexOf('await ownerPassword()'));
 assert.ok(code.indexOf('await verifyCatalogReadOnly')<code.indexOf('report.remoteWriteAttempted=true'));
 for(const marker of ['assertOutsideRepository','assert.equal(old.trim(),OLD_REF)','MAIN_WAREHOUSE_SCHEMA_OR_PERMISSION_CHANGED','MAIN_WAREHOUSE_NOTIFICATION_HOLD_CHANGED','delete env.PGPASSWORD','reference.appliedVersions'])assert.ok(code.includes(marker),marker);
 assert.doesNotMatch(code,/migration repair|db push|\.link\(|readReference182|readReady150/u);
});
