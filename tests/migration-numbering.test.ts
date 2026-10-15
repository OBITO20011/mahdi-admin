import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {assertMigrationNumbering,unusedMigrationNumbers,startupReservedNumbers,codexMigrationNumbers} from '../scripts/agent/migration-numbering.mjs';
test('current151 sequence has exactly the permanent140-149 gap and new reserved lanes',async()=>{
 const state=JSON.parse(await readFile('docs/agent/project-state.json','utf8'));
 const names=(await readdir('supabase/migrations')).filter(n=>/^\d+_.+\.sql$/u.test(n)).sort();
 assert.equal(assertMigrationNumbering(names,state).files,names.length);
 for(const changed of [names.filter(n=>!n.startsWith('139_')),[...names,names[0]!],[...names,'140_forbidden.sql'].sort(),[...names,'160_unapproved.sql'].sort()])
  assert.throws(()=>assertMigrationNumbering(changed,state));
 assert.throws(()=>assertMigrationNumbering(names,{...state,reservedMigrationNumbers:unusedMigrationNumbers}));
 assert.throws(()=>assertMigrationNumbering(names,{...state,unusedMigrationNumbers:[]}));
});
test('reservation is metadata,not permission to raise ceiling or silently skip another number',()=>{
 const state={migrationCeiling:162,unusedMigrationNumbers,reservedMigrationNumbers:startupReservedNumbers,codexMigrationNumbers};
 const names=Array.from({length:162},(_,i)=>i+1).filter(n=>!unusedMigrationNumbers.includes(n)).map(n=>String(n).padStart(3,'0')+'_fixture.sql');
 assert.equal(assertMigrationNumbering(names,state).ceiling,162);
 assert.throws(()=>assertMigrationNumbering(names.filter(n=>!n.startsWith('152_')),state));
 assert.throws(()=>assertMigrationNumbering(names,{...state,migrationCeiling:151}));
});
