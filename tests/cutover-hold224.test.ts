import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {canonicalLf,sha256} from '../scripts/testing/maintenance-db-contract.mjs';
import {parseCutoverHoldArgs,runCutoverHold224,cutoverHoldJobs} from '../scripts/operations/frankfurt-owner-cutover-hold224.mjs';
import {sourceBeforeCutoverHold224,cutoverHold224Pins} from '../scripts/audit/source-before-cutover-hold224.mjs';

test('owner cutover holds have separate modes and never infer apply',async()=>{
 assert.deepEqual([...cutoverHoldJobs].sort(),[
  'cleanup-guest-order-gateway-requests','expire-stale-new-website-orders','owner-telegram-dispatch',
  'run-advanced-monitoring','scan-business-summaries','scan-core-business-alerts',
 ]);
 assert.equal(parseCutoverHoldArgs(['--hold-upgrade']).mode,'dry-run');
 for(const phase of ['upgrade','reset']){
  assert.equal(parseCutoverHoldArgs(['--hold-'+phase,'--verify']).mode,'verify');
  assert.deepEqual(await runCutoverHold224(['--hold-'+phase,'--plan']),{ok:true,phase,mode:'plan',
   networkAccess:false,remoteWriteAttempted:false,dryRunDefault:true,applyRequiresOwner:true});
 }
 assert.throws(()=>parseCutoverHoldArgs(['--hold-reset','--apply']),/CUTOVER_HOLD_RESET_VERIFY_REPORT_REQUIRED/);
 assert.throws(()=>parseCutoverHoldArgs(['--hold-reset','--verify','--verify-report','file']),/CUTOVER_HOLD_RESET_VERIFY_REPORT_REQUIRED/);
 assert.throws(()=>parseCutoverHoldArgs(['--hold-upgrade','--hold-reset']),/CUTOVER_HOLD_ONE_PHASE_REQUIRED/);
 assert.throws(()=>parseCutoverHoldArgs(['--hold-upgrade','--apply','--verify']),/CUTOVER_HOLD_ONE_MODE_REQUIRED/);
 assert.throws(()=>parseCutoverHoldArgs(['--hold-upgrade','--db-url','https://unknown.example']),/CUTOVER_HOLD_UNKNOWN_OPTION/);
});

test('historical source projection recognizes only the reviewed cutover hold bytes',()=>{
 for(const [file,pin] of Object.entries(cutoverHold224Pins)){
  const raw=canonicalLf(readFileSync(file,'utf8'));
  assert.equal(sha256(raw),pin.after);
  assert.equal(sourceBeforeCutoverHold224(file,raw),pin.beforeText);
  assert.equal(sourceBeforeCutoverHold224(file,raw+'\nUNKNOWN_BYTE'),raw+'\nUNKNOWN_BYTE');
 }
});
