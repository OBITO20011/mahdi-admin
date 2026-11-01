// 218 remains owner-reserved. This reference is independently built217 ->219.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {assertReady217Catalog} from './frankfurt-reference217.mjs';
import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
import {migrationManifest,manifestDigest,canonicalLf,canonicalDefinitionLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql,realtime151Tables} from '../testing/realtime151-contract.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';

export const ready219Ceiling=219,ready219ReferenceName='local-reference-through219-ready.json';
const sql=canonicalLf(readFileSync(new URL('../../supabase/migrations/219_home_financial_facts_narrow_projection.sql',import.meta.url),'utf8'));
export const home219Body=sql.slice(sql.indexOf('AS $$')+5,sql.lastIndexOf('$$;'));
export function assertReady219Catalog(catalog){
  assertReady217Catalog(catalog);
  const matches=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith('phase6_financial_facts_before208_internal('));
  assert.equal(matches.length,1,'HOME219_EXACT_EXISTING_PRIVATE_FUNCTION');
  const f=matches[0];assert.equal(f.owner,'postgres');
  assert.deepEqual(f.configuration,['search_path=public, pg_temp']);
  assert.match(f.definition,/STABLE/u);assert.match(f.definition,/SECURITY DEFINER/u);
  assert.deepEqual(aclEntries(f.acl,f,'functions').filter(a=>a.grantee!=='postgres'),[]);
  const body=f.definition.match(/AS (\$[a-zA-Z0-9_]*\$)([\s\S]*)\1/u)?.[2];
  assert.equal(canonicalDefinitionLf(body??''),canonicalDefinitionLf(home219Body),'HOME219_EXACT_REVIEWED_BODY');
  return catalog;
}
export function assertReady219Reference(reference,manifest,proofText,source){
  assert.equal(reference.format,29);assert.equal(reference.migrationCeiling,219);
  assert.equal(manifest.length,180);assert.equal(manifest.at(-1).name,'219_home_financial_facts_narrow_projection.sql');
  assert.ok(!manifest.some(m=>m.name.startsWith('218_')),'BACKUP218_REMAINS_RESERVED');
  assert.deepEqual(reference.manifest,manifest);assert.equal(reference.manifestDigest,manifestDigest(manifest));
  assert.deepEqual(reference.appliedVersions,manifest.map(m=>m.name.slice(0,3)));
  assert.equal(reference.catalogQuerySha256,sha256(schemaCatalogSql));assert.equal(reference.catalogSha256,sha256(JSON.stringify(reference.catalog)));
  assert.equal(reference.realtimeQuerySha256,sha256(realtimePublicationSql));assert.equal(reference.realtimeSha256,sha256(JSON.stringify(reference.realtimePublication)));
  assert.deepEqual(reference.realtimePublication.tables.map(t=>t.schema+'.'+t.name).sort(),realtime151Tables.map(t=>'public.'+t).sort());
  assert.equal(reference.realtimePublication.publication.owner,'postgres');assert.equal(reference.realtimePublication.publication.allTables,false);
  assert.deepEqual(Object.keys(reference.prefixes),['217','219']);
  for(const version of ['217','219']){
    const prefix=reference.prefixes[version];assert.equal(prefix.catalogSha256,sha256(JSON.stringify(prefix.catalog)));
    assert.deepEqual(prefix.appliedVersions,manifest.filter(m=>Number(m.name.slice(0,3))<=Number(version)).map(m=>m.name.slice(0,3)));
    assert.deepEqual(prefix.realtimePublication,reference.realtimePublication);
  }
  assertReady217Catalog(reference.prefixes['217'].catalog);assertReady219Catalog(reference.catalog);
  assert.deepEqual(reference.prefixes['219'].catalog,reference.catalog);assert.equal(reference.freshIncrementalDifferenceCount,0);
  const proof=JSON.parse(proofText);assert.equal(proof.migrationCeiling,219);assert.equal(proof.managedAccess,false);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);
  assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));
  assert.ok(proof.results.every(r=>r.sqlstate===null));assert.deepEqual(proof.manifest,manifest.map(m=>m.name));
  const compared=compareManagedCatalog(proof.catalog,reference.catalog,{beforeBuildDate:proof.startedAt.slice(0,10),afterBuildDate:reference.buildUtcDate});
  assert.deepEqual(compared.unexpected,[]);assert.deepEqual(compared.expected,[]);
  assert.deepEqual(reference.readiness,{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0});
  assert.equal(reference.functions,633);return reference;
}
export async function readReady219Reference(root,filename){
  return assertReady219Reference(JSON.parse(await readFile(filename,'utf8')),
    (await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=219),
    await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_219.json'),'utf8'),await inventory());
}
