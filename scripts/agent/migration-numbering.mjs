// Owner2026-10-15 numbering policy only;never authorizes a migration or merge.
import assert from 'node:assert/strict';
export const unusedMigrationNumbers=Object.freeze(Array.from({length:10},(_,i)=>140+i));
export const startupReservedNumbers=Object.freeze(Array.from({length:10},(_,i)=>160+i));
export const codexMigrationNumbers=Object.freeze(Array.from({length:8},(_,i)=>152+i));
export const cloudMigrationNumbers=Object.freeze(Array.from({length:10},(_,i)=>170+i));
export const nextCloudMigrationNumbers=Object.freeze(Array.from({length:10},(_,i)=>180+i));
// Approved PR1 integration advances directly151 ->160. These drafts were never
// migrations; their old lane must not be backfilled after164 without a new decision.
export const deferredMigrationNumbers=Object.freeze([...codexMigrationNumbers,165,166,167,168,169]);
export function assertMigrationNumbering(names,state){
 assert.deepEqual(state.unusedMigrationNumbers,unusedMigrationNumbers,'PERMANENT140_149_GAP_REQUIRED');
 assert.deepEqual(state.reservedMigrationNumbers,startupReservedNumbers,'STARTUP160_169_RESERVATION_REQUIRED');
 assert.deepEqual(state.codexMigrationNumbers,codexMigrationNumbers,'CODEX152_159_LANE_REQUIRED');
 assert.deepEqual(state.cloudMigrationNumbers,cloudMigrationNumbers,'CLOUD170_179_RESERVATION_REQUIRED');
 assert.deepEqual(state.nextCloudMigrationNumbers,nextCloudMigrationNumbers,'NEXT_CLOUD180_189_RESERVATION_REQUIRED');
 assert.deepEqual(state.deferredMigrationNumbers,deferredMigrationNumbers,'DEFERRED152_159_GAP_REQUIRED');
 const numbers=names.map(name=>{
  assert.match(name,/^\d{3}_.+\.sql$/u,'THREE_DIGIT_MIGRATION_REQUIRED');return Number(name.slice(0,3));
 });
 assert.equal(new Set(numbers).size,numbers.length,'DUPLICATE_MIGRATION_NUMBER');
 assert.ok(!numbers.some(n=>unusedMigrationNumbers.includes(n)),'RETIRED140_149_MUST_REMAIN_UNUSED');
 assert.ok(!numbers.some(n=>deferredMigrationNumbers.includes(n)),'DEFERRED152_159_MUST_REMAIN_UNUSED');
 assert.ok(Number.isSafeInteger(state.migrationCeiling)&&state.migrationCeiling>=151,'APPROVED_CEILING_REQUIRED');
 const expected=Array.from({length:state.migrationCeiling},(_,i)=>i+1).filter(n=>!unusedMigrationNumbers.includes(n)&&!deferredMigrationNumbers.includes(n));
 assert.deepEqual(numbers,expected,'MIGRATION_GAP_OR_ABOVE_CEILING');
 return {ceiling:state.migrationCeiling,files:numbers.length,unused:unusedMigrationNumbers,reserved:startupReservedNumbers};
}
