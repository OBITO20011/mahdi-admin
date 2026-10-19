import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {singleWarehouseOption} from '../src/components/ui/singleWarehouseOption';
import {readWarehouseAdministration,warehouseSavePayload} from '../src/services/supabase/warehouses.service';
import {sourceBeforeWarehouseManagement} from '../scripts/audit/source-before-warehouse-management.mjs';
import {bindFirstOwnerAndWarehouseSql} from '../scripts/operations/first-owner-warehouse-core.mjs';
import {bindFirstOwnerSql} from '../scripts/operations/first-owner-core.mjs';
import {assert199History} from '../scripts/operations/frankfurt-owner-upgrade199.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
import {projectHistoricalWarehouseQuerySites,verifyHistoricalWarehouseCoverage} from '../scripts/audit/historical-warehouse-query-sites.mjs';

test('sole active branch warehouse only, never an arbitrary warehouse in another branch',()=>{
  const one={id:'one',branchId:'a',name:'المستودع الرئيسي'},two={id:'two',branchId:'b',name:'مستودع آخر'};
  assert.equal(singleWarehouseOption([one,two],'a'),one);
  assert.equal(singleWarehouseOption([one,two]),null);
  assert.equal(singleWarehouseOption([one,{...two,branchId:'a'}],'a'),null);
  assert.equal(singleWarehouseOption([{...one,isActive:false}], 'a'),null);
  assert.equal(singleWarehouseOption([two],'a'),null);
});
test('warehouse owner upgrade refuses incomplete,substituted or newer history',()=>{
  const base=Array.from({length:160},(_,n)=>String(n));
  const reference={prefixes:{'198':{appliedVersions:base}},appliedVersions:[...base,'199']};
  assert.deepEqual(assert199History(base,reference),['199']);assert.deepEqual(assert199History([...base,'199'],reference),[]);
  assert.throws(()=>assert199History(base.slice(1),reference));
  assert.throws(()=>assert199History([...base.slice(0,-1),'different'],reference));
  assert.throws(()=>assert199History([...base,'199','200'],reference));
  const cli=readFileSync('scripts/operations/frankfurt-owner-upgrade199.mjs','utf8');
  assert.ok(cli.includes("pending:['199']"));assert.ok(cli.includes('readReady199Reference'));
  const workflow=readFileSync('.github/workflows/quality.yml','utf8');
  assert.match(workflow,/suite: \[[^\]]*warehouse-management/u);
  assert.match(workflow,/run-warehouse-management-gates\.mjs/u);
});
test('management payload is explicit, null version creates and exact timestamp updates',()=>{
  assert.deepEqual(warehouseSavePayload({id:'id',code:'WH-MAIN',name:' الاسم ',branchId:'branch',isActive:false,expectedUpdatedAt:'stamp'}),
    {p_id:'id',p_code:'WH-MAIN',p_name:'الاسم',p_branch_id:'branch',p_is_active:false,p_expected_updated_at:'stamp'});
  assert.throws(()=>readWarehouseAdministration({branches:[],warehouses:[{}]}));
  assert.throws(()=>readWarehouseAdministration({branches:null,warehouses:[]}));
});
test('future first-owner composes the complete original identity guard and main warehouse in one transaction',()=>{
  const p={ownerId:'441d69b5-9705-4d01-987a-c235b10995f3',email:'owner@example.test',name:'المالك',branchCode:'BR-MAIN',branchName:'الفرع الرئيسي'};
  const original=bindFirstOwnerSql(p),sql=bindFirstOwnerAndWarehouseSql(p);
  assert.ok(sql.includes(original.slice(original.indexOf('\n DO '),original.lastIndexOf('\n SELECT jsonb_build_object('))));
  assert.equal((sql.match(/BEGIN ISOLATION LEVEL SERIALIZABLE;/gu)||[]).length,1);
  assert.equal((sql.match(/\n COMMIT;/gu)||[]).length,1);
  assert.match(sql,/MAIN_WAREHOUSE_OWNER_REQUIRED/u);assert.match(sql,/warehouseReady/u);
});
test('all existing financial awaits, RPC payloads and event-value handlers are unchanged per modified product file',()=>{
  const snapshot=JSON.parse(readFileSync('scripts/audit/warehouse-management-hunks.json','utf8'));
  const printer=ts.createPrinter({removeComments:true});
  const collect=(file:string,source:string)=>{
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),calls:string[]=[],bindings:string[]=[];
    function walk(n:ts.Node){
      if(ts.isAwaitExpression(n)||(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&['rpc','from'].includes(n.expression.name.text)))calls.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));
      if(ts.isJsxAttribute(n)&&['onChange','onSubmit','onClick','disabled','required'].includes(n.name.getText(ast)))bindings.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));
      ts.forEachChild(n,walk);
    }walk(ast);return {calls,bindings};
  };
  for(const [file,pin] of Object.entries(snapshot.entries) as [string,{added?:boolean}][]){
    const current=readFileSync(file,'utf8').replaceAll('\r\n','\n');
    assert.throws(()=>sourceBeforeWarehouseManagement(file,current+'\nvoid 1;'),file+' whole-file drift must fail');
    if(pin.added){assert.equal(sourceBeforeWarehouseManagement(file,current),null);continue;}
    const before=execFileSync('git',['show',snapshot.baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
    assert.equal(sourceBeforeWarehouseManagement(file,current),before,file);
    assert.deepEqual(collect(file,current),collect(file,before),file+' AST calls/handlers/required/disabled must be identical');
  }
});
test('new warehouse RPCs have owner gate, stock/history guards and no direct table grants or delete',()=>{
  const sql=readFileSync('supabase/migrations/199_owner_warehouse_management.sql','utf8');
  assert.equal((sql.match(/PERFORM public.assert_erp_role\(ARRAY\['owner'\]/gu)||[]).length,2);
  assert.match(sql,/on_hand_quantity<>0 OR reserved_quantity<>0/u);
  assert.match(sql,/WAREHOUSE_HAS_MOVEMENTS/u);
  assert.match(sql,/WAREHOUSE_HAS_PRODUCTS/u);
  const reader=sql.match(/'hasProductAssociations',\(([\s\S]*?)\n {6}\)/u)?.[1];
  const writer=sql.match(/IF NOT p_is_active AND v_exists AND v_before.is_active AND \(([\s\S]*?)\n {2}\) THEN RAISE EXCEPTION 'WAREHOUSE_HAS_PRODUCTS/u)?.[1];
  assert.ok(reader&&writer);
  assert.equal(reader.replaceAll('w.id','p_id').replace(/\s+/gu,''),writer.replace(/\s+/gu,''),'reader and writer must cover identical product associations');
  assert.match(sql,/NOT p_is_active AND v_exists AND v_before.is_active\s+AND EXISTS\(SELECT 1 FROM public.inventory_movements/u);
  assert.match(sql,/LOCK TABLE public.warehouses IN ACCESS EXCLUSIVE MODE/u);
  assert.doesNotMatch(sql,/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)\s+ON\s+(?:TABLE\s+)?public\.warehouses/iu);
  assert.doesNotMatch(sql,/DELETE FROM public\.warehouses/iu);
});

test('historical line-ID projection proves exact query content;current real gate never accepts old IDs',async()=>{
 const source=await inventory(),old=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_198.json','utf8'));
 assert.throws(()=>verifyProbeCoverage(source,old.results),/INCOMPLETE_QUERY_PROBE_COVERAGE/u);
 assert.deepEqual(verifyHistoricalWarehouseCoverage(source,old.results),old.coverage);
 assert.equal(projectHistoricalWarehouseQuerySites(source).entries.length,source.entries.length);
 assert.throws(()=>verifyHistoricalWarehouseCoverage(source,old.results.slice(1)),/INCOMPLETE_QUERY_PROBE_COVERAGE/u);
 assert.throws(()=>verifyHistoricalWarehouseCoverage(source,[...old.results,old.results[0]]),/DUPLICATE_QUERY_PROBE/u);
 const changed=structuredClone(source),entry=changed.entries.find(e=>e.file==='src/features/pos/PosView.tsx')!;
 entry.calls[0].args=['"different_column"'];
 assert.throws(()=>projectHistoricalWarehouseQuerySites(changed),/HISTORICAL_QUERY_INVENTORY_DRIFT/u);
});
