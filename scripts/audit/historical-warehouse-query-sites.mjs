// Historical query IDs include a line number. Rewind only the fully pinned
// warehouse presentation layer, while proving every original query is identical.
// Current runtime coverage always uses the unprojected default verifier.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseSource} from './table-access-inventory.mjs';
import {sourceBeforeWarehouseManagement} from './source-before-warehouse-management.mjs';
import {verifyProbeCoverage} from './table-access-probes.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const semantic=entry=>({...entry,id:null,line:null,extensions:entry.extensions.map(e=>({...e,line:null}))});
export function projectHistoricalWarehouseQuerySites(source){
 const mappings=new Map();
 for(const file of new Set(source.entries.map(e=>e.file))){
  const current=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
  assert.equal(source.sources.find(s=>s.file===file)?.sha256,hash(current),'HISTORICAL_QUERY_CURRENT_FILE_HASH:'+file);
  const before=sourceBeforeWarehouseManagement(file,current);
  assert.ok(before!==null,'HISTORICAL_QUERY_FILE_MUST_NOT_BE_NEW');
  if(before===current)continue;
  const a=parseSource(file,current).entries,b=parseSource(file,before).entries;
  const supplied=source.entries.filter(e=>e.file===file);
  const pick=(entry,keys)=>Object.fromEntries(keys.map(k=>[k,entry[k]]));
  assert.deepEqual(supplied.map(e=>semantic(pick(e,Object.keys(a[0])))),a.map(semantic),'HISTORICAL_QUERY_INVENTORY_DRIFT:'+file);
  assert.deepEqual(a.map(semantic),b.map(semantic),'HISTORICAL_QUERY_ARGUMENTS_OR_COVERAGE_CHANGED:'+file);
  for(let i=0;i<a.length;i++)mappings.set(a[i].id,b[i]);
 }
 return {...source,entries:source.entries.map(e=>{
  const old=mappings.get(e.id);return old?{...e,id:old.id,line:old.line}:e;
 })};
}
export function verifyHistoricalWarehouseCoverage(source,results){
 return verifyProbeCoverage(projectHistoricalWarehouseQuerySites(source),results);
}
