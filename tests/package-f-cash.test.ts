import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {countedCashMinorUnits} from '../src/components/ui/cashCounting';

const baseline=[
  {
    "file": "src/features/shifts/ShiftsView.tsx",
    "callHash": "cfba04ac84df2c75bcaf9674a1d5263621d6733a18c7d370af9e5c4a93519da7",
    "changeHash": "3efac0b6bddeec589f4e07f6389f8c7fcfdc2d780ccace139ae2d0b3216ac9f2",
    "handlers": {
      "handleRefresh": "c758e0fff6f00bac9aef0ecc1385a3730ee7df3a59a900ef8f695cf7f7615fad",
      "handleOpen": "81d78a448cba89e0e18b7ebd07a8b002c2754199ec184a5f7c09fe62661458db",
      "handleOpenReport": "d708ba10ff9415c84b7678eb6266a217908def12d44338beb38397854f0c6b95",
      "handleClose": "b2a2165c8416ecbdac4989583cb92418eb921cc65da052ed04731b028fa5ef1c",
      "handleCancelEmptyShift": "76d8bd2987387f7a2dbe7fd0b55de58977c63b3b9c056967d94a5dd95d0423bc",
      "resetFullReversalPanel": "12ceafb20cbcf36a424378773dcef34483f08e8ec90ea28daa035992df8293ed",
      "handlePreviewFullReversal": "80595f601c3bf8bae2195a0f5878ba98e6d9ba9196157da612435fc6891ea9b2",
      "handleExecuteFullReversal": "fb1f885034cec2f482aef6a2d998617e5703ff18856370cbade0e2560101d13e"
    },
    "calls": 13,
    "changes": 6
  },
  {
    "file": "src/features/shifts/ShiftArchiveSection.tsx",
    "callHash": "76c916e23d93553a065044161c9cb35ff52c5fb8ac2789fbd4cb0b8ae7782cdb",
    "changeHash": "afae9531f526234ada87d4cd79387601cc61d41553053c97c65d9ac372723b8f",
    "handlers": {
      "loadPage": "26c6b17015e2cdb88540a6658d0de1988ff9974bd43c44c588a37d7a6bbb2ec0",
      "applyFilters": "7bdb843d65b147d0968558f51fd7c3f6b3a83412ff9a34023641a7ecc7b623f4",
      "changePage": "5cf1fcc82d7bd8db04dc24985a557c3c2e83d0c92ac74267a2cdace00de28f53"
    },
    "calls": 2,
    "changes": 6
  },
  {
    "file": "src/features/shifts/ShiftClosingReportModal.tsx",
    "callHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "changeHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "handlers": {
      "handlePrint": "c877ef756a5d69d4dd3901af4519b214a87e583c6b310fcd41166b2c1c6decd9"
    },
    "calls": 0,
    "changes": 0
  }
] as const;
test('Cash business calls,input-value callbacks and handler bodies match e122ad6 exactly',()=>{
  const printer=ts.createPrinter({removeComments:true}),hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
  for(const expected of baseline){
    const ast=ts.createSourceFile(expected.file,readFileSync(expected.file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),calls:string[]=[],changes:string[]=[],handlers:Record<string,string>={};
    function visit(n:ts.Node){
      if(ts.isAwaitExpression(n)||ts.isCallExpression(n)&&/(?:FromSupabase|Service|\.rpc$|^run[A-Z]|^openModal$)/u.test(n.expression.getText(ast)))calls.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));
      if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='onChange'&&n.initializer)changes.push(printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast));
      if(ts.isVariableDeclaration(n)&&/^handle|^loadPage$|^applyFilters$|^changePage$|^resetFull/u.test(n.name.getText(ast))&&n.initializer)handlers[n.name.getText(ast)]=hash(printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast));
      ts.forEachChild(n,visit);
    }
    visit(ast);assert.equal(calls.length,expected.calls);assert.equal(changes.length,expected.changes);
    assert.equal(hash(calls.sort()),expected.callHash);assert.equal(hash(changes.sort()),expected.changeHash);assert.deepEqual(handlers,expected.handlers);
  }
});
test('denomination counting is exact minor-unit local input,never a server expected-cash source',()=>{
  assert.equal(countedCashMinorUnits(['14','4','2','1','3'],'1.800'),809800);
  assert.equal(countedCashMinorUnits(['','','','',''],''),0);
  assert.equal(countedCashMinorUnits(['0','0','0','0','0'],'0.001'),1);
  for(const invalid of ['-1','1.2','NaN','Infinity'])assert.equal(countedCashMinorUnits([invalid,'','','',''],''),undefined);
  for(const invalid of ['-1','1.0001','NaN','1e3'])assert.equal(countedCashMinorUnits(['','','','',''],invalid),undefined);
  assert.equal(countedCashMinorUnits(['9007199254740991','','','',''],''),undefined);
  assert.equal(countedCashMinorUnits(['1'],''),undefined);
});
test('Cash surfaces use shared tokens and preserve explicit unavailable facts and all safety gates',()=>{
  for(const {file} of baseline){const source=readFileSync(file,'utf8');assert.doesNotMatch(source,/(?:bg|text|border)-(?:slate|blue|gray|rose|emerald|amber|cyan|orange|indigo)-\d/u);}
  const source=readFileSync(baseline[0].file,'utf8');
  assert.match(source,/عدد العمليات: غير متاح/u);assert.match(source,/مبيعات الدين للذمم<\/span><span>غير متاح/u);
  assert.match(source,/needsReason && discrepancyReason.trim\(\).length < 2/u);assert.match(source,/fullReversalConfirmation.trim\(\) !== 'إلغاء الوردية'/u);
  assert.match(source,/CashDenominationCounter disabled=\{isSubmitting\} onApply=\{setActualCashInput\}/u);
  assert.doesNotMatch(source,/openModal\(|\.rpc\(/u);
  assert.match(source,/!currentShift && recentHistory/u);
  assert.doesNotMatch(source,/shift\.cashDiscrepancy \|\| 0/u);
});

test('Arabic shift time is isolated with automatic direction,not forced LTR',()=>{
  const source=readFileSync('src/features/shifts/ShiftsView.tsx','utf8');
  assert.match(source,/<bdi dir="auto" data-testid="cash-start-time">\{formatUiTime\(currentShift.startTime\)\}<\/bdi>/u);
  for(const {file} of baseline){
    assert.doesNotMatch(readFileSync(file,'utf8'),/<bdi[^>]*dir="ltr"[^>]*>\s*\{formatUiTime/u);
  }
});

test('dialog audit readiness comes from actual spring completion without hiding contrast rules',()=>{
  const modal=readFileSync('src/components/common/Modal.tsx','utf8');
  assert.match(modal,/data-state="opening"/u);
  assert.match(modal,/onAnimationComplete=\{\(\) => panel.current\?\.setAttribute\('data-state', isOpen \? 'open' : 'closed'\)\}/u);
  const browser=readFileSync('e2e/package-f-cash.spec.ts','utf8');
  assert.match(browser,/toHaveAttribute\('data-state','open'\)/u);
  assert.match(browser,/v.impact==='serious'\|\|v.impact==='critical'/u);
  assert.doesNotMatch(browser,/waitForTimeout|disableRules|exclude\(|test\.skip/u);
});
