// A retained reset rebuilds public INSIDE THE SAME database. Its platform
// partitions must be compared literally, never shifted by start/end UTC days.
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {catalogDifference} from '../testing/schema-catalog.mjs';

export function canonicalResetAcl(catalog){
  const copy=structuredClone(catalog);
  for(const rows of Object.values(copy))for(const row of rows??[]){
    if(Array.isArray(row.acl))row.acl.sort();
    for(const column of row.columns??[])if(Array.isArray(column.acl))column.acl.sort();
  }
  return copy;
}
export const compareResetCatalog=(before,after)=>catalogDifference(canonicalResetAcl(before),canonicalResetAcl(after));

// Sanitize ONLY diagnostic files. The guard compares the original values;
// hashes retain evidence when two different secrets would both be redacted.
export function resetCatalogDiagnostic(value){
  const redactedFields=[];
  const patterns=[
    /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/gu,
    /\b\d{6,15}:[A-Za-z0-9_-]{30,}\b/gu,
    /\b(?:ghp_|github_pat_|sk_live_|sk-proj-)[A-Za-z0-9_-]{16,}\b/gu,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gu,
    /postgres(?:ql)?:\/\/[^\s'"@]+:[^\s'"@]+@/giu,
  ];
  const visit=(input,location)=>{
    if(typeof input==='string'){
      let result=input;
      for(const regex of patterns)result=result.replace(regex,'[REDACTED]');
      if(result!==input)redactedFields.push({path:location,sha256:createHash('sha256').update(input).digest('hex')});
      return result;
    }
    if(Array.isArray(input))return input.map((item,index)=>visit(item,location+'/'+index));
    if(input&&typeof input==='object')return Object.fromEntries(Object.entries(input).map(([key,item])=>[key,visit(item,location+'/'+key)]));
    return input;
  };
  return {catalog:visit(value,''),redactedFields};
}
export async function writeResetCatalogEvidence(output,before,after,{stage='unknown',preAlignment=false}={}){
  const differences=compareResetCatalog(before,after);
  const names=preAlignment?['reset-catalog-before.json','reset-catalog-pre-alignment.json','reset-pre-alignment-differences.json']:
    ['reset-catalog-before.json','reset-catalog-after.json','reset-catalog-differences.json'];
  const values=[before,after,differences];
  const redactions=[];
  for(let i=0;i<names.length;i++){
    const safe=resetCatalogDiagnostic(values[i]);
    await writeFile(path.join(output,names[i]),JSON.stringify(safe.catalog,null,2)+'\n');
    for(const field of safe.redactedFields)redactions.push({file:names[i],...field});
  }
  await writeFile(path.join(output,'reset-catalog-evidence.json'),JSON.stringify({
    format:1,stage,comparison:'same-database-literal-all-schemas',differenceCount:differences.length,
    files:names,redactions,businessRowsIncluded:false,authOrMfaRowsIncluded:false,
  },null,2)+'\n');
  return differences;
}
export async function captureResetFailureEvidence({output,before,readAfter,stage}){
  try{
    if(!before)throw new Error('RESET_BEFORE_CATALOG_NOT_CAPTURED');
    await writeResetCatalogEvidence(output,before,await readAfter(),{stage});
  }catch{
    // Diagnostic failure must never replace the original rejection.
    await writeFile(path.join(output,'reset-catalog-evidence-unavailable.json'),JSON.stringify({
      code:'RESET_DIAGNOSTIC_CAPTURE_UNAVAILABLE',stage,beforeAvailable:!!before,
    },null,2)+'\n').catch(()=>{});
  }
}
