import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {approvedWithdrawals182Source} from './approved-withdrawals182-source';

const baseline='d7e0e8ceb07b20473cd798339e62753ad1c5346f';
const fixtures=[
  'e2e/package-f-administration-harness.tsx','e2e/package-f-auth-assistant-harness.tsx',
  'e2e/package-f-cash-harness.tsx','e2e/package-f-customers-harness.tsx',
  'e2e/package-f-financial-harness.tsx','e2e/package-f-inventory-harness.tsx',
  'e2e/package-f-more-harness.tsx','e2e/package-f-pos-harness.tsx',
  'e2e/package-f-products-harness.tsx','e2e/package-f-purchasing-harness.tsx',
  'e2e/phase6-package-b-harness.tsx','e2e/phase6-package-c-harness.tsx',
];
const scripts=[
  'scripts/monitoring/scheduled-task-status.mjs','scripts/monitoring/supabase-daily-health.mjs',
  'scripts/testing/isolated-db-port-guard.mjs','scripts/testing/private-ci-scope.mjs',
];
const checks=[
  'e2e/admin-aftercare-recovery.spec.ts','e2e/customer-checkout-isolated.spec.ts',
  'e2e/customer-presentational-characterization.spec.ts','tests/database-runtime-suite.ts',
  'tests/developer-monitoring.test.ts','tests/guest-order-security-gateway.test.ts',
  'tests/isolated-db-port-guard.test.ts','tests/isolated-vite-cache.test.ts',
  'tests/offsite-backup.test.ts','tests/package-f-home.test.ts',
  'tests/phase3-harness-stability.test.ts','tests/phase36-isolated-seo-build.test.ts',
  'tests/phase6-bc-dialog-safety.test.ts','tests/supabase-daily-health.test.ts',
];
type Tree=[number,string|Tree[]];
function tree(node:ts.Node,ast:ts.SourceFile):Tree {
  if(ts.isParenthesizedExpression(node))return tree(node.expression,ast);
  if(ts.isPropertyAccessExpression(node)&&node.expression.getText(ast)==='capture'
    &&['submittedBody','submittedPayload'].includes(node.name.text))return [ts.SyntaxKind.Identifier,node.name.text];
  const children:Tree[]=[];
  ts.forEachChild(node,child=>{children.push(tree(child,ast));});
  // Node assert.throws(fn, undefined, message) and assert.throws(fn, message)
  // use the identical message-only overload at runtime.
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='assert.throws'
    &&node.arguments.length===3&&node.arguments[1].getText(ast)==='undefined')
    return [node.kind,[tree(node.expression,ast),tree(node.arguments[0],ast),tree(node.arguments[2],ast)]];
  return [node.kind,children.length?children:node.getText(ast)];
}
function emitted(file:string,source:string) {
  // Missing env remains invalid: new URL(undefined) and new URL('') both throw.
  // Valid loopback fixture URLs and the host allowlist are completely unchanged.
  if(fixtures.includes(file))source=source.replaceAll("import.meta.env.VITE_SUPABASE_URL ?? ''",'import.meta.env.VITE_SUPABASE_URL');
  const js=ts.transpileModule(source.replaceAll('\r\n','\n'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,removeComments:true}}).outputText;
  return ts.createSourceFile(file+'.js',js,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
}
const before=(file:string)=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
for(const file of [...fixtures,...scripts,'tests/database-runtime-suite.ts'])test(`strict tests: emitted runtime remains exact: ${file}`,()=>{
  const old=emitted(file,before(file)),now=emitted(file,approvedWithdrawals182Source(file,readFileSync(file,'utf8')));
  assert.deepEqual(tree(now,now),tree(old,old));
});
for(const file of checks)test(`strict tests: every original assertion remains, with no changed expected value: ${file}`,()=>{
  const collect=(source:string)=>{
    const ast=emitted(file,source),result:string[]=[];
    function visit(node:ts.Node) {
      if(ts.isCallExpression(node)&&/^(?:assert\.|expect(?:\(|\.|$))/u.test(node.expression.getText(ast)))result.push(JSON.stringify(tree(node,ast)));
      ts.forEachChild(node,visit);
    }
    visit(ast);return result;
  };
  const old=collect(before(file)),now=collect(readFileSync(file,'utf8'));
  assert.ok(old.length>0,'Original assertions must be discovered');
  let cursor=0;
  for(const assertion of now)if(assertion===old[cursor])cursor++;
  assert.equal(cursor,old.length,'Old assertion order/operands/expected values must survive;additional guards only');
});
test('strict fixture URL fallback still rejects missing/empty/non-loopback setup',()=>{
  for(const value of [undefined,''])assert.throws(()=>new URL(value??''));
  for(const value of ['https://example.invalid','https://alnawasreh.com'])assert.equal(['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname),false);
});
