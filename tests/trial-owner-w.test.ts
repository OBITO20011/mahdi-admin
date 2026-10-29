import {sourceBeforeStoreIdentity} from '../scripts/audit/source-before-store-sharing-identity.mjs';
import {pathsBeforeHandover213} from '../scripts/audit/source-before-handover213.mjs';
import {sourceBeforeTrialR,trialRPins} from '../scripts/audit/source-before-trial-owner-r.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {sourceBeforeTrialW,trialWPins} from '../scripts/audit/source-before-trial-owner-w.mjs';

test('W exact additive inverse preserves the delivered base and rejects unapproved source changes',()=>{
 const base='e96efc13ebf27b82217b856f8e6152de8bcc6c55';
 for(const [file,pin]of Object.entries(trialWPins) as [string,{added?:boolean;approvedHistoricalSnapshots?:{ref:string;sha256:string}[]}][]){
  const current=readFileSync(file,'utf8'),restored=sourceBeforeTrialW(file,current);
  assert.throws(()=>sourceBeforeTrialW(file,current+'\nvoid unapproved;\n'),file);
  if(pin.added)assert.equal(restored,null,file);
  else{
   const before=execFileSync('git',['show',base+':'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n');
   assert.equal(restored,before,file);assert.throws(()=>sourceBeforeTrialW(file,before+'\nvoid unapproved;\n'),file);
  }
  for(const snapshot of pin.approvedHistoricalSnapshots??[]){
   const approved=execFileSync('git',['show',snapshot.ref+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
   assert.equal(createHash('sha256').update(approved).digest('hex'),snapshot.sha256);
   assert.equal(sourceBeforeTrialW(file,approved),approved);
   assert.throws(()=>sourceBeforeTrialW(file,approved+'\nvoid unapproved;\n'),file);
  }
 }
 const changed=execFileSync('git',['diff','--name-only',base,'--','supabase','scripts/audit/*-hunks.json'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.deepEqual(pathsBeforeHandover213(changed).filter(file=>!['scripts/audit/trial-owner-w-hunks.json','scripts/audit/trial-owner-r-hunks.json','supabase/migrations/212_trial_readable_cash_product_choices_damage_history.sql'].includes(file)),[],'No SQL/RPC changes or edits to earlier immutable source pins');
 const state=JSON.parse(readFileSync('docs/agent/project-state.json','utf8'));assert.equal(state.migrationCeiling,217);
});

test('W preserves every service/Supabase call and keeps authority modules unchanged',()=>{
 const base='e96efc13ebf27b82217b856f8e6152de8bcc6c55';
 const printer=ts.createPrinter({removeComments:true});
 function calls(file:string,text:string){
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=new Set(['supabase']);
  for(const statement of source.statements)if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier)&&/services\/|lib\/supabase/u.test(statement.moduleSpecifier.text)){
   const bindings=statement.importClause?.namedBindings;
   if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)names.add(item.name.text);
  }
  const result:string[]=[];
  function root(node:ts.Expression):string|null{
   if(ts.isIdentifier(node))return node.text;
   if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node))return root(node.expression);
   if(ts.isCallExpression(node))return root(node.expression);
   return null;
  }
  function visit(node:ts.Node){if(ts.isCallExpression(node)&&names.has(root(node.expression)??''))result.push(printer.printNode(ts.EmitHint.Unspecified,node,source));ts.forEachChild(node,visit);}
  visit(source);return result.sort();
 }
 for(const file of Object.keys(trialWPins).filter(file=>file.startsWith('src/')&&file.endsWith('.tsx'))){
  const before=execFileSync('git',['show',base+':'+file],{encoding:'utf8',maxBuffer:32*1024**2});
  assert.deepEqual(calls(file,sourceBeforeTrialR(file,readFileSync(file,'utf8'))!),calls(file,before),file);
 }
 const authority=execFileSync('git',['diff','--name-only',base,'--','supabase','src/services','src/utils','src/stores','src/lib'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).filter(file=>{if(['src/services/deviceBiometrics.service.ts','src/stores/useAuthStore.ts'].includes(file)){assert.equal(sourceBeforeStoreIdentity(file,readFileSync(file,'utf8')),execFileSync('git',['show','f95ff0458f90298edc21e39859d3268c7f7ccac7:'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'));return false;}return true;}).filter(file=>pathsBeforeHandover213([file]).length>0&&!trialRPins[file]&&file!=='supabase/migrations/212_trial_readable_cash_product_choices_damage_history.sql').join('\n');
 assert.equal(authority,'','No writer, reader, pricing, permission or persisted-store contract changes');
});
