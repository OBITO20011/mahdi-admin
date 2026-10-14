import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const source=readFileSync('tests/isolated-vite-cache.test.ts','utf8');
const ast=ts.createSourceFile('isolated-vite-cache.test.ts',source,ts.ScriptTarget.Latest,true);
const declaration=ast.statements.filter(ts.isVariableStatement).flatMap(s=>[...s.declarationList.declarations])
  .find(d=>ts.isIdentifier(d.name)&&d.name.text==='until');
assert.ok(declaration?.initializer);
const emitted=ts.transpileModule(`const until=${declaration.initializer.getText(ast)};`,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
type Until=(condition:()=>boolean,onFailure?:()=>void)=>Promise<void>;

test('readiness diagnostics stay silent on success and do not poll an already ready optimizer',async()=>{
  let reports=0,polls=0;
  const until=runInNewContext(emitted+';until',{
    Date:{now:()=>0},assert,poll:async()=>{polls++;},
  }) as Until;
  await until(()=>true,()=>{reports++;});
  assert.equal(reports,0);assert.equal(polls,0);
});

test('readiness diagnostics report once and rethrow the identical original deadline error',async()=>{
  const failure=new Error('original readiness assertion');let clockCalls=0,reports=0,polls=0;
  const until=runInNewContext(emitted+';until',{
    Date:{now:()=>clockCalls++===0?0:15000},
    assert:{ok:(condition:boolean,message:string)=>{
      assert.equal(message,'Real optimizer state must become ready');
      if(!condition)throw failure;
    }},
    poll:async()=>{polls++;},
  }) as Until;
  await assert.rejects(()=>until(()=>false,()=>{reports++;}),(error:unknown)=>error===failure);
  assert.equal(reports,1);assert.equal(polls,0);assert.equal(clockCalls,2);
});

test('readiness diagnostics retain original limits and forward silent logger behavior',()=>{
  assert.match(source,/const deadline = Date\.now\(\) \+ 15000;/u);
  assert.match(source,/await poll\(10\);/u);
  assert.match(source,/originalWarn\(message, options\);/u);
  assert.match(source,/originalError\(message, options\);/u);
  assert.match(source,/kind: 'VITE_OPTIMIZER_READINESS_FAILURE'/u);
  assert.doesNotMatch(source,/JSON\.stringify\((?:server|common|process\.env)/u);
});

test('shared-cache reproducer uses real fixed tiny packages without losing HTTP regression assertions',()=>{
  const shared=source.slice(source.indexOf("test('two real shared-cache"),source.indexOf("test('unique temporary"));
  assert.match(shared,/\['cache-proof-a', 'cache-proof-b'\]/u);
  assert.match(shared,/main: 'index\.cjs'/u);
  assert.match(shared,/preTransformRequests: false/u);
  assert.match(shared,/entries: \['cache-proof-a\.html'\]/u);
  assert.match(shared,/entries: \['cache-proof-b\.html'\]/u);
  assert.doesNotMatch(shared,/include: \['(?:lucide-react|recharts)'\]/u);
  assert.match(shared,/assert\.equal\(response\.status, 504\)/u);
  assert.match(shared,/assert\.equal\(response\.statusText, 'Outdated Optimize Dep'\)/u);
  assert.match(source,/for \(let request = 0; request < 10; request\+\+\)/u);
  assert.match(source,/assert\.equal\(response\.status, 200\)/u);
  assert.match(source,/await assert\.rejects\(access\(a\.cacheDir\)\); await assert\.rejects\(access\(b\.cacheDir\)\)/u);
});
