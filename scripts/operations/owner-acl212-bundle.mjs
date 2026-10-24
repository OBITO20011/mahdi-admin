// The reviewed transaction is immutable. Only its final result projection is
// replaced with a machine-readable summary; all guards and REVOKEs are exact.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalLf} from '../testing/maintenance-db-contract.mjs';
export const ownerAcl212SqlSha256='040a218eec0e557bebb0c6aeff0d0df12c07a1d6527dd5a16e1c8bbc7857c2e8';
export const ownerAcl212ReferenceSha256='db0ad398c47c59d55e7cb47de4e0c3f51a616a2457bb927773a98a8e34c41f0c';
const hash=s=>createHash('sha256').update(s).digest('hex');
const projection='SELECT object_kind,object_identity,owner_name,configuration,acl,removed_privileges,matches_reference\n FROM pg_temp.owner_acl212_result ORDER BY object_kind,object_identity COLLATE "C";\nCOMMIT;';
export async function readOwnerAcl212Bundle(root){
 const sql=canonicalLf(await readFile(path.join(root,'docs/operations/FRANKFURT_FUNCTION_ACL212_OWNER.sql'),'utf8'));
 assert.equal(hash(sql),ownerAcl212SqlSha256,'OWNER_ACL212_REVIEWED_SQL_CHANGED');
 const captured=sql.match(/\$manifest212\$([\s\S]*?)\$manifest212\$/u);assert.ok(captured,'OWNER_ACL212_MANIFEST_REQUIRED');
 const manifest=JSON.parse(captured[1]);assert.equal(manifest.ceiling,212,'OWNER_ACL212_CEILING');
 assert.equal(manifest.referenceSha256,ownerAcl212ReferenceSha256,'OWNER_ACL212_REFERENCE_CHANGED');
 assert.equal(manifest.objects.length,675,'OWNER_ACL212_SCOPE');
 assert.equal(sql.split(projection).length,2,'OWNER_ACL212_RESULT_PROJECTION_CHANGED');
 const executionSql=sql.replace(projection,`DO $acl212_result_guard$ BEGIN
 IF (SELECT count(*) FROM pg_temp.owner_acl212_result)<>675
  OR EXISTS(SELECT 1 FROM pg_temp.owner_acl212_result WHERE matches_reference IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'OWNER_ACL212_RESULT_MISMATCH'; END IF;
END; $acl212_result_guard$;
SELECT jsonb_build_object('rows',count(*),
 'matches_reference_true',count(*) FILTER(WHERE matches_reference IS TRUE),
 'matches_reference_false',count(*) FILTER(WHERE matches_reference IS DISTINCT FROM true),
 'removed_privileges',coalesce(sum(removed_privileges),0),
 'results',jsonb_agg(jsonb_build_object('object_kind',object_kind,'object_identity',object_identity,
  'removed_privileges',removed_privileges,'matches_reference',matches_reference)
  ORDER BY object_kind,object_identity COLLATE "C")) FROM pg_temp.owner_acl212_result;
COMMIT;`);
 return {sql,executionSql,manifest,sqlSha256:ownerAcl212SqlSha256,executionSha256:hash(executionSql)};
}
export function parseOwnerAcl212Result(stdout,manifest){
 let result;try{result=JSON.parse(stdout.trim());}catch{throw new Error('OWNER_ACL212_INVALID_RESULT');}
 assert.deepEqual(Object.keys(result).sort(),['matches_reference_false','matches_reference_true','removed_privileges','results','rows'],'OWNER_ACL212_INVALID_RESULT');
 assert.equal(result.rows,675,'OWNER_ACL212_ROW_COUNT');assert.equal(result.matches_reference_true,675,'OWNER_ACL212_POSTCONDITION');
 assert.equal(result.matches_reference_false,0,'OWNER_ACL212_POSTCONDITION');assert.equal(result.results?.length,675,'OWNER_ACL212_ROW_COUNT');
 const expected=new Map(manifest.objects.map(o=>[o.section+'\0'+o.signature,o.allowedExtra.length])),seen=new Set();let removed=0;
 for(const row of result.results){
  assert.deepEqual(Object.keys(row).sort(),['matches_reference','object_identity','object_kind','removed_privileges'],'OWNER_ACL212_INVALID_RESULT');
  const key=row.object_kind+'\0'+row.object_identity;
  assert.ok(expected.has(key)&&!seen.has(key),'OWNER_ACL212_RESULT_IDENTITY');seen.add(key);
  assert.equal(row.matches_reference,true,'OWNER_ACL212_POSTCONDITION');
  assert.ok(Number.isSafeInteger(row.removed_privileges)&&row.removed_privileges>=0&&row.removed_privileges<=expected.get(key),'OWNER_ACL212_INVALID_REDUCTION');
  removed+=row.removed_privileges;
 }
 assert.equal(removed,result.removed_privileges,'OWNER_ACL212_INVALID_REDUCTION');
 return result;
}
