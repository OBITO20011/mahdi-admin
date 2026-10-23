import {trialWPins} from '../scripts/audit/source-before-trial-owner-w.mjs';
import {pretrialP1Pins} from '../scripts/audit/source-before-pretrial-p1.mjs';
import {corrections207Pins} from '../scripts/audit/source-before-corrections207.mjs';
import {navigation206Pins} from '../scripts/audit/source-before-navigation-cash206.mjs';
import {receiving205Pins} from '../scripts/audit/source-before-product-receiving205.mjs';
import {sales204Pins} from '../scripts/audit/source-before-sales-history204.mjs';
import {collections202Pins} from '../scripts/audit/source-before-collections202.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {homeDamage201Pins} from '../scripts/audit/source-before-home-damage201.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {approvedCheques195Source,cheques195Files} from './approved-cheques195-source';
import {restore198CollectionPresentation} from '../scripts/audit/source-before198-presentation.mjs';

const baseline='18217d193acf0041c6319064f29501484501d8c7';
for(const file of cheques195Files)test('cheques: every byte outside exact approved additions matches accepted182: '+file,()=>{
  const current=readFileSync(file,'utf8'),source=file==='src/features/crm/CustomerCollectionModal.tsx'?restore198CollectionPresentation(current):current;
  const before=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
  assert.equal(approvedCheques195Source(file,source),before);
  if(Object.hasOwn(corrections207Pins,file))assert.throws(()=>approvedCheques195Source(file,source+'\n// unapproved mutation\n'),/CORRECTIONS207_ENTIRE_CURRENT_FILE_CHANGED/u,'newest exact full-file pin rejects extra logic');
  else if(Object.hasOwn(navigation206Pins,file))assert.throws(()=>approvedCheques195Source(file,source+'\n// unapproved mutation\n'),/NAVIGATION206_ENTIRE_CURRENT_FILE_CHANGED/u,'newest full-file pin rejects extra logic');
  else if(Object.hasOwn(receiving205Pins,file))assert.throws(()=>approvedCheques195Source(file,source+'\n// unapproved mutation\n'),/RECEIVING205_ENTIRE_CURRENT_FILE_CHANGED/u,'current entire-file pin rejects extra logic');
  else if(Object.hasOwn(sales204Pins,file))assert.throws(()=>approvedCheques195Source(file,source+'\n// unapproved mutation\n'),/SALES204_ENTIRE_CURRENT_FILE_CHANGED/u,'newest full-file pin rejects mutation');
  else if(Object.hasOwn(homeDamage201Pins,file))assert.throws(()=>approvedCheques195Source(file,source+'\n// unapproved mutation\n'),Object.hasOwn(collections202Pins,file)?/COLLECTIONS202_ENTIRE_CURRENT_FILE_CHANGED/u:/HOME_DAMAGE201_ENTIRE_CURRENT_FILE_CHANGED/u,'latest exact entire-file pin rejects unapproved drift');
  else if(['src/App.tsx','src/components/layout/sideNavigationModel.ts','src/features/more/adminNavigation.config.ts','src/features/pos/PosView.tsx','src/stores/appStorePreferences.ts'].includes(file))assert.throws(()=>approvedCheques195Source(file,source+'\n// unapproved mutation\n'),/WAREHOUSE_ENTIRE_CURRENT_FILE_CHANGED/u,'newer whole-file warehouse pin rejects mutation before legacy projection');
  else if(file==='src/features/goLive/GoLiveSetupView.tsx') assert.throws(()=>approvedCheques195Source(file,source+'\n// unapproved mutation\n'),/TERMINOLOGY_ENTIRE_CURRENT_FILE_CHANGED/u,'whole-file presentation pin rejects mutation');
  else if(Object.hasOwn(pretrialP1Pins,file))assert.throws(()=>approvedCheques195Source(file,source+'\n// unapproved mutation\n'),/PRETRIAL_P1_ENTIRE_CURRENT_FILE_CHANGED/u,'P1 exact entire-file guard rejects mutation before legacy hunks');
  else if(Object.hasOwn(trialWPins,file))assert.throws(()=>approvedCheques195Source(file,source+'\n// unapproved mutation\n'),new RegExp(trialWPins[file].errorPrefix),'W exact entire-file guard rejects extra logic');
  else assert.notEqual(approvedCheques195Source(file,source+'\n// unapproved mutation\n'),before,'outside-hunk changes remain observable');
});
test('cheques parity rejects a changed original sale callback or new authorization boundary',()=>{
  const file='src/features/pos/PosView.tsx',source=readFileSync(file,'utf8');
  const authorizationMutation=source.replace("'cashier','sales'","'cashier','sales','guest'");
  assert.notEqual(authorizationMutation,source,'control must mutate the authorization boundary');
  assert.throws(()=>approvedCheques195Source(file,authorizationMutation),/WAREHOUSE_ENTIRE_CURRENT_FILE_CHANGED/u);
  const mutation=source.replace('const executeSale =','const UNAPPROVED_executeSale =');
  assert.notEqual(mutation,source,'control must mutate an existing handler');
  assert.throws(()=>approvedCheques195Source(file,mutation),/WAREHOUSE_ENTIRE_CURRENT_FILE_CHANGED/u);
});

test('approved late-supplier fixture admits exact event/role additions only,not changed readiness or privileges',()=>{
  const file='e2e/package-f-purchasing-harness.tsx',source=readFileSync(file,'utf8');
  for(const [current,changed] of [["'fixture-suppliers-ready'","'unapproved-ready-event'"],["roleName:paymentRole","roleName:'owner'"]]){
    const mutation=source.replace(current!,changed!);assert.notEqual(mutation,source);
    assert.throws(()=>approvedCheques195Source(file,mutation),/RECEIVING205_ENTIRE_CURRENT_FILE_CHANGED/u);
  }
});
