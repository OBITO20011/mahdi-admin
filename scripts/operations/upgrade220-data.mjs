import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {salesOnlySchemas} from './sales-only220-catalog.mjs';
const md5=s=>createHash('md5').update(s).digest('hex');
const privateName=name=>salesOnlySchemas.some(s=>name.startsWith(s+'.'));
/** Existing business/Auth rows are identical. Only eleven NEW private tables
 * may appear:the reviewed true/full mode singleton and otherwise empty rows. */
export function assert220SourceRowsPreserved(before,after,reference){
 assert.ok(!Object.keys(before.tables).some(privateName),'UPGRADE220_PRIVATE219_PREFIX_UNEXPECTED');
 const historical=value=>Object.fromEntries(Object.entries(value.tables).filter(([name])=>name!=='supabase_migrations.schema_migrations'&&!privateName(name)));
 assert.deepEqual(historical(after),historical(before),'UPGRADE220_BUSINESS_OR_AUTH_ROWS_CHANGED');
 const expected=reference.catalog.tables.filter(t=>salesOnlySchemas.includes(t.schema)&&['r','p'].includes(t.kind)).map(t=>t.schema+'.'+t.name).sort();assert.equal(expected.length,11);
 assert.deepEqual(Object.keys(after.tables).filter(privateName).sort(),expected,'UPGRADE220_EXACT_PRIVATE_TABLES_REQUIRED');
 for(const name of expected)assert.deepEqual(after.tables[name],name==='sales_lite1.mode'?{rows:1,hash:md5('{"id": true, "full_accounting": true}')}:{rows:0,hash:md5('')},'UPGRADE220_PRIVATE_INITIAL_ROWS_CHANGED:'+name);
}
