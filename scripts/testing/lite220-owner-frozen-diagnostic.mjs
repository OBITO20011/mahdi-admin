// Render the owner SQL Editor check from the literal frozen220_before rows.
// A single SELECT statement keeps its result visible and cannot change ACLs.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {frozen220FrankfurtAclCte} from './sales-only220-compiler.mjs';

export function frozen220BeforeDiagnostic(migration){
 const match=migration.match(/DO \$frozen220_before\$ DECLARE mismatches BIGINT; frankfurt_matches BIGINT; BEGIN\n WITH expected\(signature,source_hash,definition_hash,owner_name,config,acl\) AS\(VALUES\n([\s\S]+?)\),\n ([\s\S]+?)\n SELECT count\(\*\) FILTER/u);
 assert.ok(match,'LITERAL_FROZEN220_BEFORE_VALUES_REQUIRED');
 assert.equal((match[1].match(/^\('/gmu)||[]).length,636,'EXACT636_DIAGNOSTIC_VALUES');
 assert.equal(match[2],frozen220FrankfurtAclCte,'FROZEN220_FRANKFURT_ACL_VALUES_REQUIRED');
 return `-- OWNER READ ONLY: run on Frankfurt 219 before upgrade/D-1. Zero rows required.
-- Paste this single statement into Supabase SQL Editor and read its result.
-- The four exact Frankfurt ACLs override the fresh local raw values only here.
WITH expected(signature,source_hash,definition_hash,owner_name,config,acl) AS(VALUES
${match[1]}),
${match[2]},
checked AS (
 SELECT e.signature,array_remove(ARRAY[
  CASE WHEN p.oid IS NULL THEN 'missing_function' END,
  CASE WHEN p.oid IS NOT NULL AND encode(pg_catalog.sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM e.source_hash THEN 'source_hash' END,
  CASE WHEN p.oid IS NOT NULL AND encode(pg_catalog.sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.definition_hash THEN 'definition_hash' END,
  CASE WHEN p.oid IS NOT NULL AND p.proowner::regrole::text IS DISTINCT FROM e.owner_name THEN 'owner' END,
  CASE WHEN p.oid IS NOT NULL AND to_jsonb(p.proconfig) IS DISTINCT FROM NULLIF(e.config,'null'::jsonb) THEN 'config' END,
  CASE WHEN p.oid IS NOT NULL AND p.proacl::text IS DISTINCT FROM COALESCE(f.acl,e.acl) THEN 'raw_acl' END
 ],NULL) AS mismatch_reasons
 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.signature)
 LEFT JOIN frankfurt_acl f ON f.signature=e.signature
)
SELECT signature,mismatch_reasons FROM checked
WHERE cardinality(mismatch_reasons)>0
ORDER BY signature;
`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 assert.equal(process.argv.length,2,'NO_CONNECTION_OR_TARGET_ARGUMENT');
 const migration=await readFile(new URL('../../supabase/migrations/220_sales_only_operating_mode.sql',import.meta.url),'utf8');
 await writeFile(new URL('../../docs/operations/RESET220_BEFORE_D1_READ_ONLY.sql',import.meta.url),frozen220BeforeDiagnostic(migration));
 console.log('OWNER219_READ_ONLY_DIAGNOSTIC_GENERATED_NO_CONNECTION');
}
