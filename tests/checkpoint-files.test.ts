import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {checkpointFileManifest,checkpointFilesPath} from '../scripts/agent/checkpoint-files.mjs';
test('large checkpoints preserve every exact dirty-file entry while keeping task metadata compact',()=>{
 const entries=Array.from({length:200},(_,n)=>({code:n%2?'AM':'??',path:`src/features/large-integration/part-${n}.tsx`}));
 const result=checkpointFileManifest([...entries,{code:' M',path:'docs/agent/ACTIVE_TASK.json'},{code:'??',path:checkpointFilesPath}]);
 assert.deepEqual(JSON.parse(result.text).files,entries);assert.equal(result.filesTouchedCount,200);
 assert.deepEqual(result.filesTouched,[checkpointFilesPath]);assert.ok(Buffer.byteLength(JSON.stringify({...result,text:undefined}))<4096);
 assert.equal(result.filesTouchedManifestSha256,createHash('sha256').update(result.text).digest('hex'));
 const changed=checkpointFileManifest([...entries.slice(1),{code:'AM',path:entries[0]!.path}]);assert.notEqual(changed.filesTouchedManifestSha256,result.filesTouchedManifestSha256);
});
