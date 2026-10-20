import {sales204Pins} from '../scripts/audit/source-before-sales-history204.mjs';
import {collections202Pins} from '../scripts/audit/source-before-collections202.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {homeDamage201Pins} from '../scripts/audit/source-before-home-damage201.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {approvedWithdrawals182Source,withdrawals182Files} from './approved-withdrawals182-source';

for(const file of withdrawals182Files)test('withdrawals182 exact approved additions preserve entire pre-integration file:'+file,()=>{
 const source=readFileSync(file,'utf8'),before=execFileSync('git',['show','b72aa55:'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
 assert.equal(approvedWithdrawals182Source(file,source),before,'All legacy calls,payloads,guards,confirmations and bindings preserved');
 const outside=source+'\nfunction unapproved(){return changeMoney(1);}\n';
 if(Object.hasOwn(sales204Pins,file))assert.throws(()=>approvedWithdrawals182Source(file,outside),/SALES204_ENTIRE_CURRENT_FILE_CHANGED/u,'newest full-file pin rejects unapproved logic');
 else if(Object.hasOwn(homeDamage201Pins,file))assert.throws(()=>approvedWithdrawals182Source(file,outside),Object.hasOwn(collections202Pins,file)?/COLLECTIONS202_ENTIRE_CURRENT_FILE_CHANGED/u:/HOME_DAMAGE201_ENTIRE_CURRENT_FILE_CHANGED/u,'latest exact whole-file pin rejects unapproved logic');
 else if(file==='src/features/directReceiving/CreateDirectReceiptModal.tsx')assert.throws(()=>approvedWithdrawals182Source(file,outside),/WAREHOUSE_ENTIRE_CURRENT_FILE_CHANGED/u,'newer full-file warehouse pin rejects unapproved logic');
 else if(['src/features/goLive/GoLiveSetupView.tsx','src/features/reports/ReportsCenterView.tsx'].includes(file))
  assert.throws(()=>approvedWithdrawals182Source(file,outside),/TERMINOLOGY_ENTIRE_CURRENT_FILE_CHANGED/u,'whole-file terminology pin rejects unapproved logic before normalization');
 else assert.notEqual(approvedWithdrawals182Source(file,outside),before,'Unapproved logic outside an approved hunk must remain visible');
});
test('withdrawals182 mapping rejects changed approved RPC arguments or money,not a blanket source exemption',()=>{
 const file='src/features/purchases/SupplierPaymentModal.tsx',source=readFileSync(file,'utf8');
 const marker="drawer.confirmCash(Number(amount), paymentMethod === 'cash')";assert.ok(source.includes(marker));
 assert.throws(()=>approvedWithdrawals182Source(file,source.replace(marker,"drawer.confirmCash(Number(amount)+1, paymentMethod === 'cash')")),/EXACT_APPROVED_WITHDRAWALS_HUNK/u);
});
