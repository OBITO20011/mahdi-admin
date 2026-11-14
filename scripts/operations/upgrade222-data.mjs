import assert from 'node:assert/strict';
// This migration adds functions only. Existing public/private/Auth table rows
// must all match; the recorded migration-history row is the sole row change.
export function assert222SourceRowsPreserved(before,after){
 const rows=value=>Object.fromEntries(Object.entries(value.tables).filter(([name])=>name!=='supabase_migrations.schema_migrations'));
 assert.deepEqual(rows(after),rows(before),'UPGRADE222_ANY_EXISTING_ROWS_CHANGED');
}
