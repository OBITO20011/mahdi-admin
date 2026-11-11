// Test-only complete-tree reconstruction for frozen SDK evidence. Current role
// probes, owner readiness and application code never use this view.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseSource,embeddedTables} from '../audit/table-access-inventory.mjs';
import {sourceBeforeProductWorkbook} from '../audit/source-before-product-workbook-text.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const hash=s=>createHash('sha256').update(s).digest('hex');
const core=e=>Object.fromEntries(Object.entries(e).filter(([key])=>!['callers','screenPaths','reachability'].includes(key)));
function files(directory){return readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e=>{
 if(['node_modules','dist','.git'].includes(e.name))return[];const absolute=path.join(directory,e.name);
 return e.isDirectory()?files(absolute):/\.[cm]?[jt]sx?$/u.test(e.name)?[path.relative(root,absolute).replaceAll('\\','/')]:[];
});}
function queries(file,text){return parseSource(file,text).entries.map(e=>{
 const selection=e.calls.find(c=>c.method==='select')?.args[0];
 const value=e.constants[selection]??(selection&&(/^[`'"]/u.test(selection)?selection.slice(1,-1):''));
 return {...e,embeddedTables:value?embeddedTables(value):[]};
});}
/** Verify current paths, hashes and complete table-query AST before rewinding
 * exact source bytes. Caller also requires the complete frozen tree signature. */
export function projectSalesOnlyPhase2Inventory(source){
 const paths=['src','customer-web/src','supabase/functions'].flatMap(base=>files(path.join(root,base)));
 assert.deepEqual(source.sources.map(row=>row.file),paths,'HISTORICAL_QUERY_INVENTORY_DRIFT:PHASE2_PATHS');
 const current=[],sources=[],entries=[];
 for(const [index,file]of paths.entries()){
  const raw=readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
  assert.equal(source.sources[index].sha256,hash(raw),'HISTORICAL_QUERY_INVENTORY_DRIFT:PHASE2_SOURCE:'+file);
  current.push(...queries(file,raw));
  const before=sourceBeforeProductWorkbook(file,raw);if(before===null)continue;
  const text=before.replaceAll('\r\n','\n');sources.push({file,sha256:hash(text)});entries.push(...queries(file,text));
 }
 assert.deepEqual(source.entries.map(core),current.map(core),'HISTORICAL_QUERY_INVENTORY_DRIFT:PHASE2_ARGUMENTS');
 return {...source,sources,entries};
}
