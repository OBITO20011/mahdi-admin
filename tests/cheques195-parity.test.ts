import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {approvedCheques195Source,cheques195Files} from './approved-cheques195-source';
import {restore198CollectionPresentation} from '../scripts/audit/source-before198-presentation.mjs';

const baseline='18217d193acf0041c6319064f29501484501d8c7';
for(const file of cheques195Files)test('cheques: every byte outside exact approved additions matches accepted182: '+file,()=>{
  const current=readFileSync(file,'utf8'),source=file==='src/features/crm/CustomerCollectionModal.tsx'?restore198CollectionPresentation(current):current;
  const before=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
  assert.equal(approvedCheques195Source(file,source),before);
  assert.notEqual(approvedCheques195Source(file,source+'\n// unapproved mutation\n'),before,'outside-hunk changes remain observable');
});
test('cheques parity rejects a changed original sale callback or new authorization boundary',()=>{
  const file='src/features/pos/PosView.tsx',source=readFileSync(file,'utf8');
  assert.throws(()=>approvedCheques195Source(file,source.replace("'cashier','sales'","'cashier','sales','guest'")),/EXACT_APPROVED_CHEQUES_HUNK/u);
  const mutation=source.replace('const executeSale =','const UNAPPROVED_executeSale =');
  assert.notEqual(mutation,source,'control must mutate an existing handler');
  assert.notEqual(approvedCheques195Source(file,mutation),approvedCheques195Source(file,source));
});

test('approved late-supplier fixture admits exact event/role additions only,not changed readiness or privileges',()=>{
  const file='e2e/package-f-purchasing-harness.tsx',source=readFileSync(file,'utf8');
  for(const [current,changed] of [["'fixture-suppliers-ready'","'unapproved-ready-event'"],["roleName:paymentRole","roleName:'owner'"]]){
    const mutation=source.replace(current!,changed!);assert.notEqual(mutation,source);
    assert.throws(()=>approvedCheques195Source(file,mutation),/EXACT_APPROVED_CHEQUES_HUNK/u);
  }
});
