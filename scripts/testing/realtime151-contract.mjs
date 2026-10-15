import assert from 'node:assert/strict';
export const realtime151Tables=Object.freeze([
 'customer_addresses','customers','inventory_balances','inventory_movements',
 'orders','products','purchase_order_items','purchase_orders','purchase_receipts',
 'supplier_payments','supplier_receipt_items','supplier_receipts','suppliers',
]);
// A separate versioned snapshot preserves the historical catalog query/hash.
// New151 references and verification MUST include this exact membership read.
export const realtimePublicationSql=`BEGIN READ ONLY;
 SELECT jsonb_build_object(
 'publication',(SELECT jsonb_build_object('name',pubname,'owner',pg_get_userbyid(pubowner),
 'allTables',puballtables,'insert',pubinsert,'update',pubupdate,'delete',pubdelete,
 'truncate',pubtruncate,'viaRoot',pubviaroot) FROM pg_publication WHERE pubname='supabase_realtime'),
 'tables',(SELECT COALESCE(jsonb_agg(jsonb_build_object('schema',schemaname,'name',tablename,
 'columns',attnames,'filter',rowfilter) ORDER BY schemaname,tablename),'[]'::jsonb)
 FROM pg_publication_tables WHERE pubname='supabase_realtime'));ROLLBACK;`;
export async function readRealtimePublication(executor){
 const {executeInput}=await import('../operations/build-empty-supabase.mjs');
 const r=await executeInput(executor,realtimePublicationSql);assert.equal(r.code,0,'REALTIME_PUBLICATION_READ_FAILED');
 return JSON.parse(r.stdout.trim());
}
export function verify151Publication(before,after){
 assert.ok(before.publication,'APPLICATION_REALTIME_PUBLICATION_MISSING');
 assert.equal(before.publication.allTables,false,'FOR_ALL_TABLES_NOT_APPROVED');
 assert.deepEqual(after.publication,before.publication,'PUBLICATION_OPTIONS_CHANGED');
 const expected=[...new Set([...before.tables.map(t=>t.schema+'.'+t.name),...realtime151Tables.map(t=>'public.'+t)])].sort();
 assert.deepEqual(after.tables.map(t=>t.schema+'.'+t.name).sort(),expected,'EXACT151_MEMBERSHIP_REQUIRED');
 for(const table of before.tables)assert.deepEqual(after.tables.find(t=>t.schema===table.schema&&t.name===table.name),table,'EXISTING_PUBLICATION_MEMBER_CHANGED');
 for(const table of after.tables)if(!before.tables.some(t=>t.schema===table.schema&&t.name===table.name))
  assert.equal(table.filter,null,'UNAPPROVED_PUBLICATION_ROW_FILTER');
 return {members:after.tables.length,added:after.tables.length-before.tables.length,optionsUnchanged:true};
}
export function classify151Frame(actor,payload){
 assert.equal(payload.schema,'public');assert.equal(payload.table,'orders');assert.equal(payload.eventType,'INSERT');
 if(payload.errors?.length){
  // Walrus explicitly reports primary-key SELECT denial with NO WAL record.
  // This is an authorization error,not successful INSERT delivery. Any data,
  // different error,or error for an actor that should have SELECT still fails.
  assert.equal(actor,'anon','UNEXPECTED_ACTOR_DENIAL');
  assert.deepEqual(payload.errors,['Error 401: Unauthorized'],'EXACT_ANON_DENIAL_REQUIRED');
  assert.deepEqual(payload.new,{},'DATA_IN_DENIED_FRAME');assert.deepEqual(payload.old,{},'DATA_IN_DENIED_FRAME');
  return 'denied';
 }
 assert.equal(actor,'staff','UNAUTHORIZED_REALTIME_RECORD');
 assert.match(payload.new?.id??'',/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u,'REAL_ORDER_ID_REQUIRED');
 assert.deepEqual(payload.old,{});return 'insert';
}
