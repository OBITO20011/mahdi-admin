import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withoutSqlComments} from '../scripts/testing/maintenance-db-contract.mjs';
import {inventory224CatalogDelta,assertInventory224CatalogDelta} from '../scripts/operations/inventory224-catalog.mjs';

const source=readFileSync('supabase/migrations/224_optional_quantity_inventory_reader.sql','utf8');
const sql=withoutSqlComments(source);
test('224 is exactly one additive owner-only STABLE reader with the approved EXECUTE boundary',()=>{
 assert.equal((sql.match(/CREATE\s+FUNCTION/giu)||[]).length,1);
 assert.match(sql,/CREATE FUNCTION public\.lite3_counters224\(/u);
 assert.match(sql,/STABLE SECURITY DEFINER SET search_path=pg_catalog,public/u);
 assert.match(sql,/PERFORM sales_lite3\.assert_owner223\(\)/u);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.lite3_counters224\(TEXT,TEXT,INTEGER,INTEGER\) FROM PUBLIC,anon,authenticated,service_role/u);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.lite3_counters224\(TEXT,TEXT,INTEGER,INTEGER\) TO authenticated/u);
 assert.doesNotMatch(sql,/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TRIGGER|SCHEMA|INDEX)\b/iu);
 assert.doesNotMatch(sql,/CREATE OR REPLACE|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/iu);
 assert.match(sql,/schema_migrations\)<>183/u);assert.match(sql,/schema_migrations\)<>223/u);
});
test('224 catalog commitment rejects extra objects, ACL changes and one unknown definition byte',()=>{
 const pins=JSON.parse(readFileSync('docs/design/inventory224/catalog224-pins.json','utf8'));
 const row=pins.changes[0].after,before={functions:[]},after={functions:[row]};
 assertInventory224CatalogDelta(before,after);
 assert.throws(()=>inventory224CatalogDelta(before,{...after,tables:[{schema:'public',name:'unexpected'}]}));
 assert.throws(()=>inventory224CatalogDelta(before,{functions:[{...row,acl:[...row.acl,'anon=X/postgres']}]}));
 assert.throws(()=>assertInventory224CatalogDelta(before,{functions:[{...row,definition:row.definition+'\nUNKNOWN_BYTE'}]}));
});
test('224 bounds the page and search, keeps global counts independent, and reads actual signed latest events',()=>{
 assert.match(sql,/p_page_size NOT BETWEEN 1 AND 100/u);
 assert.match(sql,/char_length\(p_search\)>256/u);
 assert.match(sql,/p_filter NOT IN\('all','low','zero'\)/u);
 assert.match(sql,/WHERE c\.enabled AND NOT p\.is_flavor_master/u);
 assert.match(sql,/FROM tracked\),/u);
 assert.match(sql,/LIMIT p_page_size OFFSET\(p_page-1\)::BIGINT\*p_page_size/u);
 assert.match(sql,/e\.quantity_after-e\.quantity_before/u);
 assert.match(sql,/ORDER BY e\.created_at DESC,e\.id DESC LIMIT 1/u);
 assert.match(sql,/actorDisplayName/u);assert.match(sql,/parent\.name_ar,p\.sku,p\.barcode/u);
 assert.match(sql,/٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹/u);
});
