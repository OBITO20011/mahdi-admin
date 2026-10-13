import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import ts from 'typescript';
// Captured from d8bc619 BEFORE the approved display/focus repair,not current source.
const baseline=[
 {file:'src/features/crm/CustomerEditModal.tsx',calls:33,callHash:'7f291fa15cbf5654003afdd90cad278eefe5a508814f680ed1c24938928bd308',formHash:'fa36e1c6a7f34620a2072a9cb4a284666f2204cfb38984aec15ced090eb596ab',bodyHash:'326a95e7835d8025652ecc26afd664b921da757ecfc54a391343073e9ccf8457'},
 {file:'src/features/crm/AddAddressModal.tsx',calls:55,callHash:'0a5f53bfa393ec3dcc2e826ea674e52ec897c555fc9bbcf60e9fdc08e93de7b6',formHash:'a1232fd8330c608d9a7652a91b510864cc227e624c5d85dce09f66da47f3365e',bodyHash:'f6e368f34e0e53b04a2bcf8fd545e91b05a3910b20d086c8624aa018d2be4c15'},
];
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
for(const expected of baseline)test(`focus repair preserves ALL calls,full form and validation/location bodies:${expected.file}`,()=>{
 const ast=ts.createSourceFile(expected.file,readFileSync(expected.file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),printer=ts.createPrinter({removeComments:true});
 const calls:string[]=[],forms:string[]=[],bodies:Record<string,string>={};const print=(n:ts.Node)=>printer.printNode(ts.EmitHint.Unspecified,n,ast);
 const visit=(n:ts.Node)=>{if(ts.isCallExpression(n))calls.push(print(n));
  if(ts.isVariableDeclaration(n)&&['submit','getLocation'].includes(n.name.getText(ast))&&n.initializer)bodies[n.name.getText(ast)]=print(n.initializer);
  if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='form')forms.push(print(n));ts.forEachChild(n,visit);};visit(ast);
 assert.equal(calls.length,expected.calls);assert.equal(hash(calls),expected.callHash);assert.equal(forms.length,1);assert.equal(hash(forms),expected.formHash);assert.equal(hash(bodies),expected.bodyHash);
});
