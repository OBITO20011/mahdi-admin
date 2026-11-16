import assert from 'node:assert/strict';

export const coreWebkitShardCount=2;
export const coreWebkitShards=Object.freeze([1,2]);
export const coreWebkitJobNames=Object.freeze(coreWebkitShards.map(shard=>`Core WebKit browser QA (${shard}/${coreWebkitShardCount})`));
export const isCoreWebkitShardArgument=value=>typeof value==='string'&&/^--shard=[12]\/2$/u.test(value);

// Native Playwright shards retain file/serial groups and the original config.
// Compare actual discovered identities, never filenames or counts alone.
export function verifyCoreWebkitShardPartition(full,parts){
 assert.equal(parts.length,coreWebkitShardCount,'CORE_WEBKIT_SHARD_MISSING');
 const keys=rows=>rows.map(row=>row.key);
 for(const rows of [full,...parts,parts.flat()]){
  assert.ok(rows.length>0,'CORE_WEBKIT_SHARD_EMPTY');
  assert.ok(rows.every(row=>row.project==='mobile-webkit'),'CORE_WEBKIT_PROJECT_MISROUTED');
  assert.equal(new Set(keys(rows)).size,rows.length,'CORE_WEBKIT_SHARD_DUPLICATE');
 }
 assert.deepEqual(keys(parts.flat()).sort(),keys(full).sort(),'CORE_WEBKIT_SHARD_COVERAGE_CHANGED');
 return parts.map(rows=>rows.length);
}
