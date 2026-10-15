import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {approvedProductEditConflictSource} from './strict-product-legacy-source';

const fixture=resolve('tests/types/required-props.tsx');
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
assert.equal(config.error,undefined);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,process.cwd());
const original=readFileSync(fixture,'utf8');
function diagnostics(source:string) {
  const host=ts.createCompilerHost(parsed.options);
  const getSourceFile=host.getSourceFile.bind(host);
  host.getSourceFile=(fileName,languageVersion,onError,shouldCreateNewSourceFile)=>
    resolve(fileName)===fixture ? ts.createSourceFile(fileName,source,languageVersion,true,ts.ScriptKind.TSX)
      : getSourceFile(fileName,languageVersion,onError,shouldCreateNewSourceFile);
  const program=ts.createProgram([fixture],parsed.options,host);
  return ts.getPreEmitDiagnostics(program);
}
test('real React19 JSX types reject a missing required PageHeader prop outside purchasing',()=>{
  const good=diagnostics(original);
  assert.deepEqual(good.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
  const bad=diagnostics(original.replace(' title="اختبار خصائص مطلوبة"',''));
  assert.equal(bad.length,1);
  assert.equal(resolve(bad[0].file!.fileName),fixture);
  assert.equal(bad[0].code,2741);
  assert.match(ts.flattenDiagnosticMessageText(bad[0].messageText,' '),/Property 'title' is missing/);
});
test('dead SmartLowStockAlertBar stays removed without invented package contents',()=>{
  const path='src/features/dashboard/SmartLowStockAlertBar.tsx';
  assert.equal(existsSync(path),false);
  function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
  const importing=files('src').filter(file=>/\bSmartLowStockAlertBar\b/u.test(readFileSync(file,'utf8')));
  assert.deepEqual(importing,[]);
});
test('type remediation preserves the complete emitted runtime AST of every changed live file',()=>{
  const baseline='7361d5cbc87ffdfe40bcee59a6bc8a8369b1c7af';
  const files=['src/components/common/AppErrorBoundary.tsx','src/components/ui/Surface.tsx',
    'src/features/accounts/AccountsView.tsx','src/features/dashboard/DashboardHome.tsx',
    'src/features/inventory/InventoryView.tsx','src/stores/useAppStore.ts'];
  const emit=(fileName:string,source:string)=>ts.transpileModule(source.replace(/\r\n/gu,'\n'),{fileName,compilerOptions:{
    jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,
  }}).outputText;
  for(const file of files){
    const before=execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
    assert.equal(emit(file,approvedProductEditConflictSource(file,readFileSync(file,'utf8'))),emit(file,before),file);
  }
});
