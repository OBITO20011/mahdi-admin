import assert from 'node:assert/strict';

export function assert224SourceRowsPreserved(before,after){
 const previous={...before.tables},current={...after.tables};
 delete previous['supabase_migrations.schema_migrations'];
 delete current['supabase_migrations.schema_migrations'];
 // Reader224 adds no relation: every existing counter/event/request stays exact.
 assert.deepEqual(current,previous,'UPGRADE224_EXISTING_APPLICATION_ROWS_CHANGED');
}
