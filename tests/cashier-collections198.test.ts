import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {futureMigrationViolations} from '../scripts/testing/maintenance-db-contract.mjs';
const read=(p:string)=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
const file='supabase/migrations/198_cashier_customer_collection_access.sql',sql=read(file);
function body(s:string,n:string){const re=new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.'+n+'\\('),m=re.exec(s);assert.ok(m,n);return s.slice(m.index,s.indexOf('\n$$;',m.index)+4).replace(/^CREATE FUNCTION/u,'CREATE OR REPLACE FUNCTION');}
test('198 five explicit role-only changes rewind exactly to original191/163/121;no payload/math/validation/reversal changes',()=>{
 const sources=[['191_cheque_unified_customer_collection','cheque_assert_customer_payment_role_internal'],['191_cheque_unified_customer_collection','collect_customer_balance_v1'],
  ['163_go_live_unified_collection_and_supplier_opening_payment','preview_customer_collection_v1'],['163_go_live_unified_collection_and_supplier_opening_payment','get_customer_collections_v1'],
  ['121_phase42_atomic_return_coordinator','get_customer_outstanding_orders_page']];
 for(const [source,name]of sources){assert.ok(source&&name);let after=body(sql,name);
  if(name==='cheque_assert_customer_payment_role_internal')after=after.replace("\n      || CASE WHEN p_method IN ('cash','cliq','bank_transfer') THEN ARRAY['cashier'] ELSE ARRAY[]::TEXT[] END",'');
  else if(name==='collect_customer_balance_v1')after=after.replace("'accountant','cashier','sales'],'تحصيل من الزبون'","'accountant','sales'],'تحصيل من الزبون'");
  else after=after.replace("'accountant', 'cashier', 'sales'","'accountant', 'sales'");
  assert.equal(after,body(read('supabase/migrations/'+source+'.sql'),name),name);
 }
 assert.equal([...sql.matchAll(/CREATE OR REPLACE FUNCTION/gu)].length,5);assert.deepEqual(futureMigrationViolations(sql),[]);
 assert.doesNotMatch(sql,/CREATE TABLE|CREATE INDEX|GRANT |REVOKE |reverse_customer|reverse_supplier|ALTER POLICY/u);
 const state=JSON.parse(read('docs/agent/project-state.json'));assert.equal(state.migrationCeiling,204);
 assert.equal(state.migration198CanonicalLfSha256,createHash('sha256').update(sql).digest('hex').toUpperCase());
});
test('198 collection UI keeps every original call and event handler;only an extra store read hides cashier reversal',()=>{
 const p='src/features/crm/CustomerCollectionModal.tsx',before=execFileSync('git',['show','0e6ab9d:'+p],{encoding:'utf8'}),after=read(p);
 function contract(source:string){const f=ts.createSourceFile(p,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),calls:string[]=[],handlers:string[]=[];
  function visit(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(f)!=='useAppStoreSelector')calls.push(ts.createPrinter().printNode(ts.EmitHint.Unspecified,n,f));
   if(ts.isJsxAttribute(n)&&/^on/u.test(n.name.getText(f)))handlers.push(ts.createPrinter().printNode(ts.EmitHint.Unspecified,n,f));ts.forEachChild(n,visit);}visit(f);return{calls,handlers};}
 const restored=after.replace("  const isCashier = useAppStoreSelector(state => state.currentUser.role === 'Cashier');\n",'').replace(': !isCashier && <UiButton',': <UiButton');
 assert.equal(restored,before.replaceAll('\r\n','\n'));
 assert.deepEqual(contract(restored),contract(before));assert.match(after,/state\.currentUser\.role === 'Cashier'/u);assert.match(after,/: !isCashier && <UiButton variant="danger"/u);
});
test('198 real DB gate covers drawer/replay/four methods/closed shift and refused reversals',()=>{
 const runtime=read('scripts/testing/run-cashier-collections198-runtime.mjs');
 for(const value of ['readApplicationFingerprint','catalogDifference','108000','109500','reverse_customer_collection_v1','reverse_customer_order_payment','CHEQUE_REQUIRES_UNIFIED_COLLECTION','close_cash_shift','get_customer_outstanding_orders_page','assertPackageDDbLint'])assert.ok(runtime.includes(value),value);
 assert.match(read('.github/workflows/quality.yml'),/run-cashier-collections198-runtime\.mjs/u);
});
test('diagnostic cleanup cannot hide original errors or prevent final evidence output',()=>{
 const runner=read('scripts/audit/run-table-access-diagnostic.mjs');
 assert.match(runner,/if\(restStarted\)try\{/u);assert.match(runner,/if\(workdir\)try\{/u);
 assert.match(runner,/cleanupErrors\.push\(\{step:'postgrest'/u);assert.match(runner,/cleanupErrors\.push\(\{step:'supabase'/u);
 assert.match(runner,/report\.cleanupErrors=cleanupErrors;report\.infrastructureOk=false;process\.exitCode=1/u);
 assert.ok(runner.lastIndexOf("'diagnostic.json'")>runner.lastIndexOf('report.cleanupErrors=cleanupErrors'));
});
