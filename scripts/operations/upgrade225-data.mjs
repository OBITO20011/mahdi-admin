import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {price225StateTable} from './on-prices225-catalog.mjs';

const stateKey='public.'+price225StateTable;
const empty={rows:0,hash:createHash('md5').update('').digest('hex')};

// A catalog-only projection is insufficient:225 also adds one empty relation.
// Every pre-existing relation, including optional quantity counters, stays exact.
export function assert225SourceRowsPreserved(before,after){
 assert.ok(!Object.hasOwn(before.tables,stateKey),'UPGRADE225_STATE_ALREADY_EXISTS');
 assert.deepEqual(after.tables[stateKey],empty,'UPGRADE225_NEW_STATE_NOT_EMPTY');
 const previous={...before.tables},current={...after.tables};
 delete previous['supabase_migrations.schema_migrations'];
 delete current['supabase_migrations.schema_migrations'];
 delete current[stateKey];
 assert.deepEqual(current,previous,'UPGRADE225_EXISTING_APPLICATION_ROWS_CHANGED');
}

export function sourceBefore225Addition(applied,beforeCatalog){
 assert.deepEqual(applied.tables[stateKey],empty,'UPGRADE225_NEW_STATE_NOT_EMPTY');
 const tables={...applied.tables};
 delete tables[stateKey];
 return {...applied,tables,catalog:beforeCatalog};
}
