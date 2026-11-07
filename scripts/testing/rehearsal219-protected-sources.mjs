import{sourceBeforeOwnerTools220}from'../audit/source-before-owner-tools220.mjs';
// Exactly two owner-approved differences plus the pinned new219 guard helper.
// No owner CLI or runtime guard imports this test-only historical/pin helper.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const dependencyRootApproval219=JSON.parse(readFileSync(new URL('./rehearsal219-dependency-root-approval.json',import.meta.url),'utf8'));
export const pgCronResetApproval219=JSON.parse(readFileSync(new URL('./rehearsal219-pg-cron-approval.json',import.meta.url),'utf8'));
export const sourceHash219=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertProtectedRehearsalSource219(file,bytes,beforeHash){
 const projected=sourceBeforeOwnerTools220(file,bytes.toString('utf8'));if(projected!==null&&projected!==bytes.toString('utf8'))bytes=Buffer.from(projected);
 const approval=dependencyRootApproval219;
 if(file===approval.file){
  assert.equal(beforeHash,approval.beforeSha256,'REHEARSAL_EXCEPTION_BASELINE_CHANGED');
  assert.equal(sourceHash219(bytes),approval.afterSha256,'REHEARSAL_ONLY_REVIEWED_DEPENDENCY_DIFF_ALLOWED');
 }else if(file===pgCronResetApproval219.file){
  assert.equal(beforeHash,pgCronResetApproval219.beforeSha256,'REHEARSAL_CRON_BASELINE_CHANGED');
  assert.equal(sourceHash219(bytes),pgCronResetApproval219.afterSha256,'REHEARSAL_ONLY_APPROVED_CRON_GUARD_DIFF_ALLOWED');
 }else if(file in pgCronResetApproval219.newFiles){
  assert.equal(beforeHash,undefined,'REHEARSAL_CRON_NEW_FILE_BASELINE');
  assert.equal(sourceHash219(bytes),pgCronResetApproval219.newFiles[file],'REHEARSAL_CRON_HELPER_CHANGED');
 }else assert.equal(sourceHash219(bytes),beforeHash,'REHEARSAL_PROTECTED_SOURCE_CHANGED:'+file);
}
export function sourceBeforeDependencyRoots219(file,text){
 text=sourceBeforeOwnerTools220(file,text);
 if(text===null)return null;
 const cron=pgCronResetApproval219;
 if(file===cron.file&&sourceHash219(text)===cron.afterSha256){
  let before=text;
  for(const p of cron.patches){assert.equal(before.split(p.after).length,2,'REHEARSAL_CRON_INVERSE_AMBIGUOUS');before=before.replace(p.after,p.before);}
  assert.equal(sourceHash219(before),cron.beforeSha256,'REHEARSAL_CRON_INVERSE_CORRUPT');return before;
 }
 if(file in cron.newFiles&&sourceHash219(text)===cron.newFiles[file])return null;
 const a=dependencyRootApproval219;
 if(file!==a.file||sourceHash219(text)!==a.afterSha256)return text;
 assert.equal(text.split(a.after).length,2,'REHEARSAL_ROOT_INVERSE_AMBIGUOUS');
 const before=text.replace(a.after,a.before);
 assert.equal(sourceHash219(before),a.beforeSha256,'REHEARSAL_ROOT_INVERSE_CORRUPT');return before;
}
