// Reproduce frozen source views from exact Git63,without editing owner dependencies.
import assert from'node:assert/strict';import{execFileSync}from'node:child_process';import{mkdtempSync,writeFileSync,readFileSync,symlinkSync,unlinkSync,rmSync,lstatSync,readdirSync}from'node:fs';import{tmpdir}from'node:os';import path from'node:path';
const root=path.resolve(import.meta.dirname,'../..'),baseline='2dafe8433bc4efef68a82fee904590aabf5fc8ad',target=path.join(root,'scripts/testing/product-workbook-history.json');
assert.ok(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--check','HISTORY_BUILD_LOCAL_ONLY');
const dir=mkdtempSync(path.join(tmpdir(),'nawasrah-workbook-history-')),link=path.join(dir,'node_modules');
const noLinks=folder=>{for(const n of readdirSync(folder)){const p=path.join(folder,n),s=lstatSync(p);assert.ok(!s.isSymbolicLink(),'UNEXPECTED_SNAPSHOT_LINK');if(s.isDirectory())noLinks(p);}};
try{
 const archive=execFileSync('git',['archive','--format=tar',baseline],{cwd:root,maxBuffer:256*1024**2});execFileSync('tar',['-xf','-','-C',dir],{input:archive,windowsHide:true,maxBuffer:1024**2});noLinks(dir);
 symlinkSync(path.join(root,'node_modules'),link,process.platform==='win32'?'junction':'dir');
 const source=`globalThis.fetch=()=>{throw Error('HISTORY_NETWORK_FORBIDDEN')};
 const {inventory,parseSource}=await import('./scripts/audit/table-access-inventory.mjs');
 const {sourceBefore198Presentation}=await import('./scripts/audit/source-before198-presentation.mjs');
 const {projectHistoricalWarehouseQuerySites}=await import('./scripts/audit/historical-warehouse-query-sites.mjs');
 const fs=await import('node:fs/promises'),crypto=await import('node:crypto'),ts=(await import('typescript')).default;
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const digest=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
 const core=e=>Object.fromEntries(Object.entries(e).filter(([k])=>!['callers','screenPaths','reachability'].includes(k)));
 const signature=v=>digest({sources:v.sources,entries:v.entries.map(core)});
 const records={},intern=v=>{const h=digest(v);records[h]=v;return h;},pack=v=>({...v,sources:v.sources.map(intern),entries:v.entries.map(intern)});
 const current=await inventory(),currentSig=signature(current),hashSig=digest(current.sources),modules=new Map();
 for(const name of(await fs.readdir('tests')).filter(n=>n.endsWith('.test.ts')).sort()){
  const text=await fs.readFile('tests/'+name,'utf8'),sf=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);
  for(const n of sf.statements)if(ts.isImportDeclaration(n)&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)){
   const file=n.moduleSpecifier.text;if(!file.startsWith('../scripts/audit/'))continue;
   for(const e of n.importClause.namedBindings.elements){const key=(e.propertyName??e.name).text;
    if(!/^inventoryBefore|^restore.*Hashes$|^project.*QuerySites$/u.test(key))continue;
    if(modules.has(key)&&modules.get(key)!==file)throw Error('HISTORY_EXPORT_COLLISION');modules.set(key,file);
   }
  }
 }
 modules.set('sourceBefore198Presentation','../scripts/audit/source-before198-presentation.mjs');modules.set('projectHistoricalWarehouseQuerySites','../scripts/audit/historical-warehouse-query-sites.mjs');
 const views={},hashOperations={},queryOperations={},unsupported=[];
 for(const[name,file]of[...modules].sort((a,b)=>a[0].localeCompare(b[0]))){
  const mod=await import(file.replace('../scripts/','./scripts/')),fn=mod[name];if(typeof fn!=='function')throw Error('HISTORY_EXPORT_MISSING');
  if(name.startsWith('inventoryBefore')){views[name]=pack(await fn());continue;}
  try{if(name==='sourceBefore198Presentation'||name.startsWith('restore'))hashOperations[name]={[hashSig]:(await fn(current.sources)).map(intern)};
  else queryOperations[name]={[currentSig]:pack(await fn(current,parseSource))};}catch{unsupported.push(name);}
 }
 console.log(JSON.stringify({baseline:${JSON.stringify(baseline)},records,current:pack(current),currentSignature:currentSig,currentHashSignature:hashSig,views,hashOperations,queryOperations,unsupported}));`;
 writeFileSync(path.join(dir,'history-reader.mjs'),source);
 const gitDir=execFileSync('git',['rev-parse','--absolute-git-dir'],{cwd:root,encoding:'utf8'}).trim();
 const output=execFileSync(process.execPath,[path.join(dir,'history-reader.mjs')],{cwd:dir,env:{...process.env,GIT_DIR:gitDir,GIT_WORK_TREE:dir},windowsHide:true,maxBuffer:64*1024**2,timeout:120000});const data=JSON.parse(output.toString('utf8'));
 const text=JSON.stringify(data,null,2)+'\n';
 if(process.argv[2]==='--check')assert.deepEqual(JSON.parse(readFileSync(target,'utf8')),data,'FROZEN_HISTORY_NOT_EXACT_GIT63');else writeFileSync(target,text);
 console.log(JSON.stringify({ok:true,baseline,currentSources:data.current.sources.length,currentQueries:data.current.entries.length,views:Object.keys(data.views).length,hashFunctions:Object.keys(data.hashOperations).length,queryFunctions:Object.keys(data.queryOperations).length}));
}finally{
 if(lstatSync(link,{throwIfNoEntry:false})?.isSymbolicLink())unlinkSync(link);
 noLinks(dir);const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('nawasrah-workbook-history-'),'CLEANUP_OUTSIDE_OWN_TEMP');rmSync(resolved,{recursive:true,force:true});
}
