// Promotion only: immutable approved phase2 financial SQL and eight exact
// bridges; no PR79 reader/H1 rewrite is admitted to the220 artifact.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {phase2PrototypeSql} from './sales-only-phase2-installer.mjs';
import {bridges,bridgedSource,replaceDefinitionSource,summaryBridgeSql} from './sales-only220-bridges.mjs';
const pins=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const q=s=>s===null?'NULL':"'"+s.replaceAll("'","''")+"'";
export const salesOnly220Name='220_sales_only_operating_mode.sql';
export function assertOriginal219Functions(rows){
 assert.ok(Array.isArray(rows),'ORIGINAL219_CATALOG_REQUIRED');assert.equal(rows.length,636,'ORIGINAL219_EXACT636');
 assert.equal(new Set(rows.map(r=>r.signature)).size,636,'ORIGINAL219_DUPLICATE');
 for(const row of rows){const pin=pins.functions[row.signature];assert.ok(pin,'ORIGINAL219_UNKNOWN_FUNCTION');
  assert.equal(hash(row.source),pin.sourceSha256,'ORIGINAL219_SOURCE_DRIFT:'+row.signature);
  assert.equal(hash(row.definition),pin.definitionSha256,'ORIGINAL219_DEFINITION_DRIFT:'+row.signature);
  for(const field of ['owner','config','acl'])assert.deepEqual(row[field],pin[field],'ORIGINAL219_METADATA_DRIFT:'+row.signature+':'+field);
 }
}
function functionGuard(rows,stage){
 const values=rows.map(row=>`(${q(row.signature)},${q(hash(row.source))},${q(hash(row.definition))},${q(row.owner)},${q(JSON.stringify(row.config))}::jsonb,${q(row.acl)})`).join(',\n');
 return `DO $frozen220_${stage}$ DECLARE mismatches BIGINT; BEGIN
 WITH expected(signature,source_hash,definition_hash,owner_name,config,acl) AS(VALUES\n${values})
 SELECT count(*) INTO mismatches FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.signature)
 WHERE p.oid IS NULL OR encode(pg_catalog.sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM e.source_hash
 OR encode(pg_catalog.sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.definition_hash
 OR p.proowner::regrole::text IS DISTINCT FROM e.owner_name OR to_jsonb(p.proconfig) IS DISTINCT FROM NULLIF(e.config,'null'::jsonb)
 OR p.proacl::text IS DISTINCT FROM e.acl;
 IF mismatches<>0 THEN RAISE EXCEPTION 'LITE220_FROZEN_${stage.toUpperCase()}_MISMATCH:%',mismatches;END IF;
 END $frozen220_${stage}$;`;
}
export function buildSalesOnly220(rows){
 assertOriginal219Functions(rows);
 rows=[...rows].sort((a,b)=>a.signature<b.signature?-1:a.signature>b.signature?1:0);
 const prefix="BEGIN;SELECT set_config('nawasrah.sales_lite1_test','OWNED_LOCAL_DB219',true);SELECT set_config('nawasrah.sales_lite2_test','OWNED_LOCAL_DB219',true);";
 let body=phase2PrototypeSql(rows);assert.ok(body.startsWith(prefix+'\n'));assert.ok(body.endsWith('\nCOMMIT;'));
 body=body.slice(prefix.length, -'COMMIT;'.length);
 const phase1Guard=readFileSync(new URL('../../docs/design/sales-only-phase1/prototype.sql',import.meta.url),'utf8').match(/DO \$\$ BEGIN\n[\s\S]+?\nEND \$\$;/u)?.[0];assert.ok(phase1Guard);
 const phase2Guard=`DO $guard$ BEGIN
 IF current_setting('nawasrah.sales_lite2_test',true) IS DISTINCT FROM 'OWNED_LOCAL_DB219'
 OR(SELECT count(*) FROM supabase_migrations.schema_migrations)<>180
 OR(SELECT max(version::integer) FROM supabase_migrations.schema_migrations)<>219
 THEN RAISE EXCEPTION 'LITE2_QUARANTINED_LOCAL219_ONLY';END IF;
 END $guard$;`;
 for(const guard of [phase1Guard,phase2Guard]){assert.equal(body.split(guard).length,2,'EXACT_PROMOTION_GUARD');body=body.replace(guard,'-- Local prototype admission replaced by the exact219/636 migration guard above.');}
 assert.doesNotMatch(body,/sales_lite[12]_test|OWNED_LOCAL_DB219/);
 body+='\n'+readFileSync(new URL('../../docs/design/sales-only-phase3/telegram-summary.sql',import.meta.url),'utf8')+'\n'+summaryBridgeSql(rows);
 const after=rows.map(row=>{if(!bridges.some(b=>b.name===row.name))return row;const source=bridgedSource(row);return {...row,source,definition:replaceDefinitionSource(row.definition,row.source,source)};});
 const guard=`DO $migration220$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>180 OR (SELECT max(version::integer) FROM supabase_migrations.schema_migrations)<>219 THEN RAISE EXCEPTION 'LITE220_EXACT219_HISTORY_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)<>636 OR to_regnamespace('sales_lite1') IS NOT NULL OR to_regnamespace('sales_lite2') IS NOT NULL THEN RAISE EXCEPTION 'LITE220_CLEAN219_REQUIRED';END IF;
 END $migration220$;`;
 return '--220: approved sales-only mode, shared ledger;627 original bodies remain byte-identical.\n--Owner10Nov: PR79 deferred to221;no full H1/M01/supplier-order changes here.\n--Historical QUARANTINED comments below identify preserved prototype source provenance.\nBEGIN;\n'+guard+'\n'+functionGuard(rows,'before')+'\n'+body+'\n'+functionGuard(after,'after')+'\nCOMMIT;\n';
}
