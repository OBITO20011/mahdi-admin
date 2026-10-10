import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {financialUiContract} from '../scripts/testing/package-f-financial-ui-contract.mjs';
import {formatJod} from '../src/components/ui/uiFormat';
const baseline=[
  {
    "file": "src/features/expenses/ExpensesView.tsx",
    "calls": 5,
    "callHash": "01315a591d216e5467d834c36d1710b336a857d16f1d148ffd3a2e91d608ec63",
    "bindings": 2,
    "bindingHash": "d420264ff82423479ebfa41744b18d043249040f97759d441183bc051058871e",
    "native": 3,
    "nativeHash": "ce854a090db1490cc15a0b817a38997f39f4522ad5c27374838b19358843005e",
    "functionHash": "23b3c3f5f6308e73eed6e81e42d242cfee2e2c7cd88438c9b93303f29254c4f5",
    "guardHash": "6e3eb6b9a44beaa8494db52a5c8d606da2b427ec41e27854eae9578805e359fc"
  },
  {
    "file": "src/features/expenses/ExpenseFormModal.tsx",
    "calls": 1,
    "callHash": "f2a15d8a81d7f46cbf5381eb9008d7feb7e68627521e6ebd2037c8168a70fb1a",
    "bindings": 7,
    "bindingHash": "b59710ec8477a8bfcab89263f01697cb1a636b634eb7f6e8339b4127a1238c1f",
    "native": 15,
    "nativeHash": "bd5ee98bf4c6138bd45a5a4c622645e0b1ff1015142df59b020e40a935dc0dbf",
    "functionHash": "a7b14b2d5a2b539891a5466ecdd6c5021c3e30c4d0e73b4a83c2b37729b92987",
    "guardHash": "99cda9dbea6a29ace887bb7a75948b0057cad2a5c2412aaec105dc872213cf34"
  },
  {
    "file": "src/features/reports/ReportsCenterView.tsx",
    "calls": 3,
    "callHash": "f5b690d6fa703587667cb368fb53377855a51d0d785886c0c7f058a2ca7e631c",
    "bindings": 9,
    "bindingHash": "93e856deb30aa21e1a11a5b60065155813a6429dde5f6b607900cfc79d3f956a",
    "native": 35,
    "nativeHash": "3a8c71fc1aedc2bda28f7961cbad9fd502b00b55aa88390b837b9e6ef9fc1399",
    "functionHash": "a7f62f0b546c98f6d6a401d25495fd7a095a829a33c0dcaa986777952411b929",
    "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  },
  {
    "file": "src/features/purchases/PurchasesView.tsx",
    "calls": 8,
    "callHash": "5ca35a880fdb15cb485ad3cbdbd7561e636ec698a67e952daeba2a305aff639b",
    "bindings": 55,
    "bindingHash": "0f75037f9b1af2caefe3a4a2a63700b2522f379f91a1867e6f478a805ffdb868",
    "native": 59,
    "nativeHash": "1ae65ad740026e9dc1fa496f2a00cb57947878c7cfef358966a738c5f5391aa6",
    "functionHash": "fbbd960f536bd21d50257dc3fdae9c385cd7e319a543823b4393dbb02d7855a5",
    "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  },
  {
    "file": "src/features/purchases/PurchaseOrderCard.tsx",
    "calls": 0,
    "callHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "bindings": 4,
    "bindingHash": "f872bad0e70efa618255e42740c4ffe2644089e666d85028695ce3d54b7f72fd",
    "native": 2,
    "nativeHash": "4f1b96411d3f9c7058c1365d2f4d9b1ecc7ba530d88a63d164074dd1330aacbc",
    "functionHash": "02d143111e96e2b5b5725f6aeb997cf72b1698b9b5b2a04180779d1ea3cf111f",
    "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  }
];

test('batch4 preserves all5 financial call,payload,value,guard and confirmation ASTs',()=>{
 for(const expected of baseline)assert.deepEqual(financialUiContract(expected.file,readFileSync(expected.file,'utf8')),expected,expected.file);
});
test('batch4 display uses tokens,shared controls and exact three-decimal Latin money',()=>{
 for(const file of baseline.slice(0,3).map(x=>x.file)){
  const s=readFileSync(file,'utf8');assert.doesNotMatch(s,/(?:bg|text|border)-(?:slate|gray|blue|rose|amber|emerald|cyan|violet)-\d/u);assert.match(s,/UiButton/u);
 }
 assert.equal(formatJod(-1234.567),'-1,234.567');assert.equal(formatJod(0),'0.000');
 const report=readFileSync(baseline[2].file,'utf8');assert.match(report,/DataTable/u);assert.match(report,/formatUiDate/u);assert.match(report,/var\(--nw-print-surface\)/u);
 assert.match(readFileSync(baseline[1].file,'utf8'),/htmlFor="expense-amount"/u);
});
test('purchasing visual notes retain exact action handlers and use primary for payment',()=>{
 const list=readFileSync(baseline[3].file,'utf8'),card=readFileSync(baseline[4].file,'utf8');
 assert.match(list,/data-testid="purchase-header-actions"/u);assert.match(list,/grid-cols-3/u);
 assert.match(card,/<UiButton variant="primary" type="button"\s+onClick=\{\(\) => onRecordPayment\(po\)\}/u);
 assert.doesNotMatch(list,/className="[^"]*bg-nw-surface[^"]*bg-nw-bad-bg/u);
});
