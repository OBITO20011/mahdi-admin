// Files and in-memory comparison ONLY. No database client, child process or network.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {readReady212Reference,assertReady212Catalog} from './frankfurt-reference212.mjs';
import {aclEntries,compareManagedCatalog} from './managed-catalog-policy.mjs';
import {canonicalDefinitionLf} from '../testing/maintenance-db-contract.mjs';
import {compareApplicationAcl} from './application-acl-verification.mjs';
import {buildOwnerAcl212Sql} from './owner-acl212-sql.mjs';
import {ownerSequenceMetadata} from './owner-acl212-sequences.mjs';

const digest=(s,algorithm='sha256')=>createHash(algorithm).update(s).digest('hex');
export function acl212Shape(row,section){
 const out={...row};delete out.acl;
 if(section==='functions'){delete out.definition;out.definitionMd5=digest(canonicalDefinitionLf(row.definition),'md5');}
 return out;
}
const name=s=>{assert.match(s,/^[a-z_][a-z0-9_]*$/u);return s;};
export function acl212Signature(row,section){
 if(section==='tables')return 'public.'+name(row.name);
 const fn=row.identity.slice(0,row.identity.indexOf('(')),args=row.identity.slice(fn.length+1,-1);
 const types=args?args.split(',').map(a=>{
  assert.match(a.trim(),/^p_\w+\s/u);const type=a.trim().replace(/^p_\w+\s+/u,'');
  assert.ok(['bigint','boolean','date','double precision','integer','jsonb','numeric','smallint','text','text[]','timestamp with time zone','uuid','uuid[]'].includes(type),'UNREVIEWED_ARGUMENT_TYPE');
  return type;
 }):[];
 return 'public.'+name(fn)+'('+types.join(',')+')';
}
export async function prepareAcl212(root,workdir){
 const input=path.join(workdir,'upgrade212-2026-10-24T09-35-30-196Z');
 const referenceFile=path.join(workdir,'local-reference-through212-ready.json'),observedFile=path.join(input,'catalog-observed.json');
 const reference=await readReady212Reference(root,referenceFile),observed=JSON.parse(await readFile(observedFile,'utf8'));
 const report=JSON.parse(await readFile(path.join(input,'report.json'),'utf8'));
 assert.equal(report.stage,'repair-212');assert.deepEqual(report.applied,['212']);assert.deepEqual(report.recorded,['212']);
 const dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:report.endedAt.slice(0,10)};
 const compared=compareManagedCatalog(reference.catalog,observed,dates);assert.deepEqual(compared.unexpected,[],'NON_ACL_APPLICATION_DIFFERENCE');
 let failure;try{assertReady212Catalog(observed);}catch(e){failure=e;}
 assert.match(failure?.stack??'',/assertReady210Catalog/u);
 assert.deepEqual(failure.actual,[['anon','EXECUTE',false],['authenticated','EXECUTE',false],['service_role','EXECUTE',false]]);
 assert.deepEqual(failure.expected,[['anon','EXECUTE',false],['authenticated','EXECUTE',false]]);
 const manifest={format:1,ceiling:212,referenceSha256:digest(await readFile(referenceFile)),observedSha256:digest(await readFile(observedFile)),
  history:reference.appliedVersions,functionNames:[...new Set(reference.catalog.functions.filter(r=>r.schema==='public').map(r=>r.identity.split('(')[0]))].sort(),
  tableNames:reference.catalog.tables.filter(r=>r.schema==='public').map(r=>r.name).sort(),objects:[],related:{}};
 const reduced=structuredClone(observed),commands=[];
 for(const section of ['functions','tables']){
  const refs=reference.catalog[section].filter(r=>r.schema==='public'),actual=observed[section].filter(r=>r.schema==='public');
  assert.equal(actual.length,refs.length,'SCOPE_COUNT_MISMATCH');
  for(const row of refs){
   const identity=row.identity??row.name,matches=actual.filter(r=>(r.identity??r.name)===identity);assert.equal(matches.length,1);
   const found=matches[0];assert.deepEqual(acl212Shape(found,section),acl212Shape(row,section),'NON_ACL_SHAPE:'+identity);
   const expectedAcl=aclEntries(row.acl,row,section),seen=aclEntries(found.acl,found,section);
   assert.ok(expectedAcl.every(e=>seen.some(a=>same(a,e))),'MISSING_PRIVILEGE:'+identity);
   const allowedExtra=seen.filter(a=>!expectedAcl.some(e=>same(e,a)));
   assert.ok(allowedExtra.every(a=>a.grantee==='service_role'&&a.grantor==='postgres'&&!a.grantable),'UNREVIEWED_EXTRA:'+identity);
   const signature=acl212Signature(row,section);
   manifest.objects.push({section,key:'public.'+identity,identity,signature,shape:acl212Shape(row,section),expectedAcl,allowedExtra,
    defaultAcl:section==='functions'?[`=X/${row.owner}`,`${row.owner}=X/${row.owner}`]:[`${row.owner}=${row.kind==='S'?'rwU':'arwdDxtm'}/${row.owner}`]});
   if(allowedExtra.length){
    const privileges=[...new Set(allowedExtra.map(a=>a.privilege))].sort();
    commands.push(`REVOKE ${privileges.join(', ')} ON ${section==='functions'?'FUNCTION':row.kind==='S'?'SEQUENCE':'TABLE'} ${signature} FROM service_role RESTRICT;`);
   }
   reduced[section].find(r=>r.schema==='public'&&(r.identity??r.name)===identity).acl=row.acl;
  }
 }
 // Validate all other public metadata, including unchanged schema/default privileges.
 for(const section of ['constraints','indexes','policies','triggers','sequences','defaultPrivileges','schemas']){
  const select=c=>(c[section]??[]).filter(r=>(section==='schemas'?r.name:r.schema)==='public').map(r=>section==='sequences'?ownerSequenceMetadata(r):r);
  const expected=structuredClone(select(reference.catalog));
  if(section==='triggers')for(const r of expected)if(r.table==='orders'&&r.name==='trg_notify_new_website_order_push')r.enabled='D';
  assert.deepEqual(select(observed),expected,'RELATED_METADATA:'+section);
  manifest.related[section]=expected;
 }
 assert.equal(compareApplicationAcl(reference.catalog,reduced).differenceCount,0);assertReady212Catalog(reduced);
 const sql=buildOwnerAcl212Sql(manifest,commands),output=path.join(root,'docs/operations/FRANKFURT_FUNCTION_ACL212_OWNER.sql');
 await writeFile(output,sql);
 const analysis={format:1,localFilesOnly:true,sqlExecuted:false,managedAccess:false,referenceSha256:manifest.referenceSha256,observedSha256:manifest.observedSha256,
  exactFailure:{function:reference.catalog.functions.find(f=>f.schema==='public'&&f.identity.startsWith('get_public_pos_receipt(')).identity,assertion:'assertReady210Catalog inherited by211/212',actual:failure.actual,expected:failure.expected},
  checkedFunctions:manifest.objects.filter(o=>o.section==='functions').length,checkedRelations:manifest.tableNames.length,
  extraObjects:manifest.objects.filter(o=>o.allowedExtra.length).length,extraFunctions:manifest.objects.filter(o=>o.section==='functions'&&o.allowedExtra.length).length,
  extraRelations:manifest.objects.filter(o=>o.section==='tables'&&o.allowedExtra.length).length,
  extraPrivileges:manifest.objects.reduce((n,o)=>n+o.allowedExtra.length,0),commands:commands.length,missingPrivileges:0,nonAclApplicationDifferences:0,
  objects:manifest.objects.map(o=>({section:o.section,signature:o.signature,expectedAcl:o.expectedAcl,removed:o.allowedExtra})),
  sqlSha256:digest(sql),platformInformationCount:compared.platform.length};
 await writeFile(path.join(root,'docs/operations/FRANKFURT_ACL212_ANALYSIS.json'),JSON.stringify(analysis,null,2)+'\n');
 return {output,checkedFunctions:analysis.checkedFunctions,checkedRelations:analysis.checkedRelations,extraFunctions:analysis.extraFunctions,extraRelations:analysis.extraRelations,extraPrivileges:analysis.extraPrivileges,commands:commands.length,sqlSha256:analysis.sqlSha256};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 assert.ok(process.argv[2],'LOCAL_OWNER_WORKDIR_REQUIRED');console.log(JSON.stringify(await prepareAcl212(path.resolve(import.meta.dirname,'../..'),path.resolve(process.argv[2]))));
}
