import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {quantity223Tables} from './optional-quantity223-catalog.mjs';

export function assert223SourceRowsPreserved(before,after){
 const previous={...before.tables},current={...after.tables};
 const empty={rows:0,hash:createHash('md5').update('').digest('hex')};
 delete previous['supabase_migrations.schema_migrations'];
 delete current['supabase_migrations.schema_migrations'];
 for(const table of quantity223Tables){
  const key='sales_lite3.'+table;
  assert.ok(!Object.hasOwn(previous,key),'UPGRADE223_COUNTER_ALREADY_EXISTS:'+key);
  assert.deepEqual(current[key],empty,'UPGRADE223_COUNTER_NOT_EMPTY:'+key);
  delete current[key];
 }
 assert.deepEqual(current,previous,'UPGRADE223_EXISTING_APPLICATION_ROWS_CHANGED');
}
