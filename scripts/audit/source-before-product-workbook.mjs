// Exact test-only projection of approved workbook/UI changes. Current inventory
// and runtime always use real sources;unknown edits are never projected away.
import{parseSource as defaultParseSource,inventory as currentInventory}from'./table-access-inventory.mjs';
import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import assert from'node:assert/strict';
const{entries}=JSON.parse(readFileSync(new URL('./product-workbook-source-pins.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeProductWorkbook(file,text){if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=entries[file];if(!pin||hash(raw)!==pin.after)return raw;if(pin.beforeText===null)return null;assert.equal(hash(pin.beforeText),pin.before,'PRODUCT_WORKBOOK_INVERSE_CORRUPT');return pin.beforeText;}
export function restoreProductWorkbookHashes(rows){return rows.flatMap(e=>{const p=entries[e.file];if(!p||p.after!==e.sha256)return[e];return p.beforeText===null?[]:[{...e,sha256:p.before}];});}
export function pathsBeforeProductWorkbook(files,reference){return files.filter(file=>{const p=entries[file];if(!p||hash(readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n'))!==p.after)return true;if(p.beforeText===null)return false;if(!reference)return true;let old=null;try{old=execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n');}catch{/* File absent in the exact reference. */}return old!==p.beforeText;});}

// Frozen historical proofs only. Default/current runtime coverage stays unprojected.
export function projectProductWorkbookQuerySites(source,parseSource=defaultParseSource){
 const entriesOut=[];
 for(const file of new Set(source.entries.map(e=>e.file))){
  const supplied=source.entries.filter(e=>e.file===file),pin=entries[file],saved=source.sources.find(s=>s.file===file);
  if(!pin||saved?.sha256!==pin.after){entriesOut.push(...supplied);continue;}
  const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');assert.equal(hash(raw),pin.after,'WORKBOOK_QUERY_SOURCE_DRIFT');
  const actual=parseSource(file,raw).entries,keys=Object.keys(actual[0]??{});assert.deepEqual(supplied.map(e=>Object.fromEntries(keys.map(k=>[k,e[k]]))),actual,'WORKBOOK_QUERY_ARGUMENT_DRIFT');
  if(pin.beforeText===null)continue;
  const previous=parseSource(file,pin.beforeText).entries,semantic=e=>({...e,id:null,line:null,extensions:e.extensions.map(x=>({...x,line:null}))});assert.deepEqual(previous.map(semantic),actual.map(semantic),'WORKBOOK_EXISTING_QUERY_CHANGED');entriesOut.push(...supplied.map((e,i)=>({...e,...previous[i]})));
 }
 return{...source,entries:entriesOut,sources:restoreProductWorkbookHashes(source.sources)};
}

export function historicalProductWorkbookSource(project,file,text,...rest){const prior=sourceBeforeProductWorkbook(file,text);return prior===null?null:project(file,prior,...rest);}

// Read-only Git63 views are reproduced by build-product-workbook-history.mjs.
// Each use is bound to the entire exact projected source/query tree;current
// probes never use these snapshots. This keeps all113 owner dependencies literal.
const frozen=JSON.parse(readFileSync(new URL('../testing/product-workbook-history.json',import.meta.url),'utf8'));
assert.equal(frozen.baseline,'2dafe8433bc4efef68a82fee904590aabf5fc8ad');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>hash(JSON.stringify(canonical(v)));
for(const[k,v]of Object.entries(frozen.records))assert.equal(digest(v),k,'FROZEN_HISTORY_RECORD_CORRUPT');
const unpackRecord=k=>{assert.ok(Object.hasOwn(frozen.records,k),'FROZEN_HISTORY_RECORD_MISSING');return structuredClone(frozen.records[k]);};
const unpackView=v=>({...structuredClone(v),sources:v.sources.map(unpackRecord),entries:v.entries.map(unpackRecord)});
const core=e=>Object.fromEntries(Object.entries(e).filter(([k])=>!['callers','screenPaths','reachability'].includes(k)));
const signature=v=>digest({sources:v.sources,entries:v.entries.map(core)});
export function historicalProductWorkbookHashes(project,rows){const before=restoreProductWorkbookHashes(rows),known=frozen.hashOperations[project.name]?.[digest(before)];return known?known.map(unpackRecord):project(before);}
export function historicalProductWorkbookQuery(project,source,...rest){
 if(rest.length)assert.equal(rest[0],defaultParseSource,'UNAPPROVED_HISTORICAL_PARSER');
 const before=projectProductWorkbookQuerySites(source,defaultParseSource),known=frozen.queryOperations[project.name]?.[signature(before)];assert.ok(known,'HISTORICAL_QUERY_INVENTORY_DRIFT:WORKBOOK');return unpackView(known);
}
export async function historicalProductWorkbookInventory(project){
 const current=await currentInventory({projectSource:sourceBeforeProductWorkbook});assert.equal(signature(current),frozen.currentSignature,'HISTORICAL_QUERY_INVENTORY_DRIFT:WORKBOOK');const known=frozen.views[project.name];assert.ok(known,'UNKNOWN_FROZEN_INVENTORY_VIEW');return unpackView(known);
}
