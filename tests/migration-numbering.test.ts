import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {assertMigrationNumbering,unusedMigrationNumbers,startupReservedNumbers,codexMigrationNumbers,deferredMigrationNumbers,cloudMigrationNumbers,nextCloudMigrationNumbers} from '../scripts/agent/migration-numbering.mjs';
test('current cheque sequence preserves explicit gaps and independent cloud reservations',async()=>{
 const state=JSON.parse(await readFile('docs/agent/project-state.json','utf8'));
 const names=(await readdir('supabase/migrations')).filter(n=>/^\d+_.+\.sql$/u.test(n)).sort();
 assert.equal(assertMigrationNumbering(names,state).files,names.length);
 for(const changed of [names.filter(n=>!n.startsWith('139_')),names.filter(n=>!n.startsWith('163_')),names.filter(n=>!n.startsWith('181_')),names.filter(n=>!n.startsWith('190_')),[...names,names[0]!],[...names,'140_forbidden.sql'].sort(),[...names,'152_unapproved.sql'].sort(),[...names,'165_unapproved.sql'].sort(),[...names,'172_unapproved.sql'].sort(),[...names,'183_unapproved.sql'].sort()])
  assert.throws(()=>assertMigrationNumbering(changed,state));
 assert.throws(()=>assertMigrationNumbering(names,{...state,reservedMigrationNumbers:unusedMigrationNumbers}));
 assert.throws(()=>assertMigrationNumbering(names,{...state,unusedMigrationNumbers:[]}));
 assert.throws(()=>assertMigrationNumbering(names,{...state,deferredMigrationNumbers:[]}));
});
test('reservation is metadata,not permission to raise ceiling or silently skip another number',()=>{
 const state={migrationCeiling:162,unusedMigrationNumbers,reservedMigrationNumbers:startupReservedNumbers,codexMigrationNumbers,deferredMigrationNumbers,cloudMigrationNumbers,nextCloudMigrationNumbers};
 const names=Array.from({length:162},(_,i)=>i+1).filter(n=>!unusedMigrationNumbers.includes(n)&&!deferredMigrationNumbers.includes(n)).map(n=>String(n).padStart(3,'0')+'_fixture.sql');
 assert.equal(assertMigrationNumbering(names,state).ceiling,162);
 assert.throws(()=>assertMigrationNumbering(names.filter(n=>!n.startsWith('161_')),state));
 assert.throws(()=>assertMigrationNumbering(names,{...state,migrationCeiling:151}));
});
