import {sourceBeforeProductReceiving205} from '../scripts/audit/source-before-product-receiving205.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {mapSheet,GO_LIVE_COLUMNS,prepareProducts,templateRows} from '../src/features/goLive/goLiveImport';
import {LEGACY_UNIT_HEADERS} from '../src/utils/legacyUnitImportHeaders';
import {formatWholesaleInventory} from '../src/utils/inventoryFormatter';
import {PURCHASE_PACKAGE_OPTIONS} from '../src/constants';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {sourceBeforeUnitTerminology} from '../scripts/audit/source-before-unit-terminology.mjs';

function sources(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sources(`${dir}/${e.name}`):/\.[jt]sx?$/u.test(e.name)?[`${dir}/${e.name}`]:[]);}
test('no generic piece terminology in UI source; exact import-only compatibility exception',()=>{
  const compatibility='src/utils/legacyUnitImportHeaders.ts';
  // Owner's exact trial-day wording; no other piece terminology is allowed.
  const approved=new Set(['src/components/modals/AllModals.tsx','src/features/more/ParcelConfigurationModal.tsx']);
  const forbidden=/حبة|حبات|الحبة|الحبات|وحدة الصنف|الوحدة الصغرى|وحدات صغرى|الوحدات الصغرى/u;
  const violations=[...sources('src'),...sources('customer-web/src')].filter(file=>{
    if(file===compatibility)return false;
    let text=readFileSync(file,'utf8');
    if(approved.has(file)){
      // D uses the same owner label in the editable form and saved legacy view.
      assert.equal(text.split('كم حبة بالطرد').length-1,file==='src/features/more/ParcelConfigurationModal.tsx'?2:1,file+' exact owner phrase count');
      text=text.replaceAll('كم حبة بالطرد','');
    }
    if(file==='src/features/products/ProductFormModal.tsx'){
      assert.equal(text.split('حبة مفردة').length-1,2,'exact owner sale-method label and validation');
      text=text.replaceAll('حبة مفردة','');
    }
    return forbidden.test(text);
  });
  assert.ok(forbidden.test('حبة')&&forbidden.test('عدد الحبات'));
  assert.deepEqual(violations,[]);
  // This module may only declare compatibility constants, not render labels.
  assert.doesNotMatch(readFileSync(compatibility,'utf8'),/return|\.map\(|React|jsx|document/u);
  assert.ok(PURCHASE_PACKAGE_OPTIONS.every(option=>String(option.code)!=='PCS'));
});
for(const kind of ['products','stock'] as const)test(`old and new ${kind} workbook headers map to IDENTICAL keys and values`,()=>{
  const sheet=templateRows(kind);
  const legacy=sheet.map(row=>[...row]);
  legacy[0]=GO_LIVE_COLUMNS[kind].map(c=>LEGACY_UNIT_HEADERS[c.key]?.[0]??c.header);
  assert.deepEqual(mapSheet(kind,sheet),mapSheet(kind,legacy));
  assert.equal(mapSheet(kind,sheet).fileErrors.length,0);
  if(kind==='products') assert.deepEqual(prepareProducts(mapSheet(kind,sheet).rows),prepareProducts(mapSheet(kind,legacy).rows));
});
test('real unit names and package-free products preserve exact quantities',()=>{
  for(const name of ['شوال','قنينة','كيس','علبة','باكيت','وحدة مخصصة','قطعة']){
    const single=formatWholesaleInventory(12,1,'طرد',name);
    assert.equal(single.fullFormatted,`12 ${name}`);
    assert.equal(single.cartons,12);assert.equal(single.remainingPieces,0);
    const mixed=formatWholesaleInventory(25,24,'طرد',name);
    assert.equal(mixed.cartonFormatted,`1 طرد + 1 ${name}`);
    assert.equal(mixed.cartons,1);assert.equal(mixed.remainingPieces,1);
  }
  assert.equal(formatWholesaleInventory(3,1,'طرد','قنينة').fullFormatted,'3 قناني');
});

test('all changed product files retain exact awaited calls, RPC/from contracts and existing onChange values',()=>{
  const snapshot=JSON.parse(readFileSync('scripts/audit/unit-terminology-hunks.json','utf8'));
  const printer=ts.createPrinter({removeComments:true});
  for(const [file,pin] of Object.entries(snapshot.entries) as [string,{added?:boolean}][]){
    const current=readFileSync(file,'utf8').replaceAll('\r\n','\n');
    if(pin.added){assert.throws(()=>sourceBeforeUnitTerminology(file,current+'\nvoid 1;'));continue;}
    const before=execFileSync('git',['show',snapshot.baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
    assert.equal(sourceBeforeUnitTerminology(file,current),before,file);
    assert.throws(()=>sourceBeforeUnitTerminology(file,current+'\nvoid 1;'),file+' whole-file drift must fail');
    function collect(text:string){
      const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
      const calls:string[]=[],changes:string[]=[];
      function walk(node:ts.Node){
        if(ts.isAwaitExpression(node) || (ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['rpc','from'].includes(node.expression.name.text)&&node.expression.expression.getText(ast)!=='Array')) calls.push(printer.printNode(ts.EmitHint.Unspecified,node,ast));
        if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='onChange')changes.push(printer.printNode(ts.EmitHint.Unspecified,node,ast));
        ts.forEachChild(node,walk);
      }
      walk(ast);return {calls,changes};
    }
    const old=collect(before),now=collect(sourceBeforeProductReceiving205(file,current)!);assert.deepEqual(now.calls,old.calls,file+' awaited calls and RPC payloads');
    const remaining=[...now.changes];for(const handler of old.changes){const i=remaining.indexOf(handler);assert.ok(i>=0,file+' existing onChange unchanged');remaining.splice(i,1);}
    assert.deepEqual(remaining,file.endsWith('ProductFormModal.tsx')?['onChange={event => setUnit(event.target.value)}']:[],file+' only authorized base-unit selector is new');
  }
});
