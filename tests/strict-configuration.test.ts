import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import ts from 'typescript';

const source=readFileSync('tsconfig.json','utf8');
const loaded=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
assert.equal(loaded.error,undefined);
const parsed=ts.parseJsonConfigFileContent(loaded.config,ts.sys,process.cwd());

test('strict umbrella remains enabled without disabling any strict family check',()=>{
  assert.equal(parsed.options.strict,true);
  const flags=['strictNullChecks','strictFunctionTypes','strictBindCallApply',
    'strictPropertyInitialization','noImplicitAny','noImplicitThis','alwaysStrict',
    'useUnknownInCatchVariables','strictBuiltinIteratorReturn'] as const;
  for(const flag of flags)assert.notEqual(parsed.options[flag],false,flag);
});

test('strict rejects implicit parameter types and null assignments in the real configuration',()=>{
  const file=resolve('__strict_configuration_contract__.ts');
  const fixture='export function identity(value) { return value; }\nconst text: string = null;\n';
  const host=ts.createCompilerHost(parsed.options),original=host.getSourceFile.bind(host);
  host.getSourceFile=(name,version,onError,createNew)=>resolve(name)===file
    ?ts.createSourceFile(name,fixture,version,true,ts.ScriptKind.TS)
    :original(name,version,onError,createNew);
  const program=ts.createProgram([file],parsed.options,host);
  const diagnostics=ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length,2);
  assert.deepEqual(diagnostics.map(d=>d.code).sort((a,b)=>a-b),[2322,7006]);
  assert.ok(diagnostics.every(d=>d.file!==undefined&&resolve(d.file.fileName)===file));
});

test('activation changes only the strict option, not compiler scope, exclusions or other settings',()=>{
  const before=execFileSync('git',['show','bf0ef2b27f2385eb33b1aacf2f9026335b69eb23:tsconfig.json'],{encoding:'utf8'});
  const withoutStrict=source.replace(/^\s*"strict": true,\r?\n/m,'');
  assert.deepEqual(JSON.parse(withoutStrict),JSON.parse(before));
});
