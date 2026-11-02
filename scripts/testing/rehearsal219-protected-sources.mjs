// The only owner-approved exception to the original112 immutable source pins.
// No owner CLI or runtime guard imports this test-only historical/pin helper.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const dependencyRootApproval219=JSON.parse(readFileSync(new URL('./rehearsal219-dependency-root-approval.json',import.meta.url),'utf8'));
export const sourceHash219=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertProtectedRehearsalSource219(file,bytes,beforeHash){
 const approval=dependencyRootApproval219;
 if(file===approval.file){
  assert.equal(beforeHash,approval.beforeSha256,'REHEARSAL_EXCEPTION_BASELINE_CHANGED');
  assert.equal(sourceHash219(bytes),approval.afterSha256,'REHEARSAL_ONLY_REVIEWED_DEPENDENCY_DIFF_ALLOWED');
 }else assert.equal(sourceHash219(bytes),beforeHash,'REHEARSAL_PROTECTED_SOURCE_CHANGED:'+file);
}
export function sourceBeforeDependencyRoots219(file,text){
 if(text===null)return null;
 const a=dependencyRootApproval219;
 if(file!==a.file||sourceHash219(text)!==a.afterSha256)return text;
 assert.equal(text.split(a.after).length,2,'REHEARSAL_ROOT_INVERSE_AMBIGUOUS');
 const before=text.replace(a.after,a.before);
 assert.equal(sourceHash219(before),a.beforeSha256,'REHEARSAL_ROOT_INVERSE_CORRUPT');return before;
}
