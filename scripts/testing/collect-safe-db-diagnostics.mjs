// Allowlisted diagnostics only. Never copy arbitrary reports/retention/auth files.
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {resetCatalogDiagnostic} from '../operations/reset-catalog-comparison.mjs';
const allowed=new Set(['reset-catalog-before.json','reset-catalog-after.json',
  'reset-catalog-pre-alignment.json','reset-catalog-differences.json',
  'reset-pre-alignment-differences.json','reset-catalog-evidence.json',
  'reset-catalog-evidence-unavailable.json','performance-report.json']);
export async function collectSafeDbDiagnostics(source,destination){
  await mkdir(destination,{recursive:true});const files=[],errors=[];
  const collect=async(directory,relativeDirectory,depth=0)=>{
    for(const file of await readdir(directory,{withFileTypes:true})){
      const relative=path.join(relativeDirectory,file.name);
      if(file.isDirectory()&&depth<4&&!file.name.includes('private')){
        await collect(path.join(directory,file.name),relative,depth+1);continue;
      }
      if(!file.isFile()||!allowed.has(file.name))continue;
      try{
        const text=await readFile(path.join(directory,file.name),'utf8');
        const sanitized=resetCatalogDiagnostic(JSON.parse(text));
        await mkdir(path.dirname(path.join(destination,relative)),{recursive:true});
        const data=JSON.stringify(sanitized.catalog,null,2)+'\n';
        await writeFile(path.join(destination,relative),data);
        files.push({file:relative.replaceAll('\\','/'),bytes:Buffer.byteLength(data),sha256:createHash('sha256').update(data).digest('hex'),redactedFields:sanitized.redactedFields});
      }catch{errors.push({directory:relativeDirectory,file:file.name,code:'SAFE_DIAGNOSTIC_COPY_FAILED'});}
    }
  };
  for(const entry of await readdir(source,{withFileTypes:true})){
    if(!entry.isDirectory()||!/^nawasrah-(?:trial-reset-|reset21[45679]-|home-|home219-|canonical197-)/u.test(entry.name))continue;
    await collect(path.join(source,entry.name),entry.name);
  }
  const result={format:1,files,errors,allowlist:[...allowed].sort(),rawReportsCopied:false,retentionOrAuthFilesCopied:false};
  await writeFile(path.join(destination,'diagnostic-manifest.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
  const target=path.resolve('test-results/safe-db-diagnostics');
  const result=await collectSafeDbDiagnostics(tmpdir(),target);
  console.log(JSON.stringify({files:result.files.length,errors:result.errors.length,output:target}));
  if(result.errors.length)process.exitCode=1;
}
