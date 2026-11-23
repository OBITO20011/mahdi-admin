import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import {sourceBeforeOn225OwnerFixes,on225OwnerFixesPins} from '../scripts/audit/source-before-on225-owner-fixes.mjs';

const file='src/features/products/ProductFormModal.tsx';
const baseline='2933c74a96e4a43a22123efa892c61d1e0d398d4';
const current=readFileSync(file,'utf8').replaceAll('\r\n','\n');
const before=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');

test('parcel pause is a controlled checkbox; checked means disabled, with the same edit/submission gate',()=>{
 const source=ts.createSourceFile(file,current,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const inputs:ts.JsxSelfClosingElement[]=[];
 const visit=(n:ts.Node)=>{if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(source)==='input')inputs.push(n);ts.forEachChild(n,visit);};visit(source);
 const checkbox=inputs.find(n=>n.attributes.getText(source).includes('checked={!accountingParcelEnabled}'));
 assert.ok(checkbox);
 assert.match(checkbox.getText(source),/type="checkbox"/u);
 assert.match(checkbox.getText(source),/disabled=\{!isEditing\|\|isSubmitting\}/u);
 assert.match(checkbox.getText(source),/onChange=\{event=>setAccountingParcelEnabled\(!event\.target\.checked\)\}/u);
 // Everything before presentation, including validation, state, RPC and save payload, is identical.
 assert.equal(current.slice(0,current.indexOf('      <Card padded={false} className="space-y-3')),before.slice(0,before.indexOf('      <Card padded={false} className="space-y-3')));
 assert.ok(!current.includes("accountingParcelEnabled?'الطرد: متاح للبيع'"));
});

test('immutable-unit hint is attached only to the existing disabled ON edit selector',()=>{
 assert.match(current,/aria-describedby=\{isEditing&&!canEditBaseUnit\?'product-base-unit-locked':undefined\}/u);
 assert.match(current,/disabled=\{isEditing&&!canEditBaseUnit\}/u);
 assert.match(current,/\{isEditing&&!canEditBaseUnit&&<span id="product-base-unit-locked"[^>]*>لا يمكن تغيير الوحدة بعد إنشاء الصنف<\/span>\}/u);
 assert.equal(current.split('لا يمكن تغيير الوحدة بعد إنشاء الصنف').length-1,1);
});

test('workbook history step retains original beforeText and exposes every unknown byte',()=>{
 const pins=on225OwnerFixesPins as Record<string,{before:string|null;after:string;beforeText:string|null;historySteps?:{baseline:string;before:string;after:string}[]}>;
 const pin=pins[file],step=pin.historySteps?.at(-1);
 assert.ok(step);assert.equal(step.baseline,baseline);assert.equal(step.before,hash(before));assert.equal(step.after,hash(current));
 assert.equal(pin.after,hash(current));
 const original=execFileSync('git',['show','db1f1a13784d35632c1f2b33a91567392ef64271:'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
 assert.equal(pin.beforeText,original);assert.equal(pin.before,hash(original));
 assert.equal(sourceBeforeOn225OwnerFixes(file,current),original);
 const unknown=current+'\nUNKNOWN_UNAPPROVED_PRODUCT_FORM_BYTE';
 assert.equal(sourceBeforeOn225OwnerFixes(file,unknown),unknown);
 const testFile='tests/on225-product-form-checkbox.test.ts',testSource=readFileSync(testFile,'utf8').replaceAll('\r\n','\n');
 assert.equal(pins[testFile].beforeText,null);
 assert.equal(sourceBeforeOn225OwnerFixes(testFile,testSource),null);
 assert.equal(sourceBeforeOn225OwnerFixes(testFile,testSource+'\nUNKNOWN_BYTE'),testSource+'\nUNKNOWN_BYTE');
});
