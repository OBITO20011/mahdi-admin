// Exact approved image-only addition. Current SDK proof still covers every new
// query/RPC; only frozen historical proofs see the original mainf95 sources.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {trial40IntegrationPins,projectTrial40Source,projectTrial40Hashes} from './source-before-trial40-integration.mjs';
import {pathsBeforeAftercare215,projectAftercare215QuerySites} from './source-before-aftercare215.mjs';
export const bulkImagePins=JSON.parse(readFileSync(new URL('./bulk-product-images-source-pins.json',import.meta.url),'utf8')).entries;
const hash=text=>createHash('sha256').update(text).digest('hex');
export function sourceBeforeBulkProductImages(file,text){
 if(text===null)return null;const projected=projectTrial40Source(file,text,bulkImagePins[file]?'bulk':'baseline');if(projected===null)return null;
 const source=projected.replaceAll('\r\n','\n'),pin=bulkImagePins[file];if(!pin)return source;
 if(hash(source)===pin.after){if(pin.added)return null;assert.equal(hash(pin.beforeText),pin.before,'BULK_IMAGES_CORRUPT_INVERSE');return pin.beforeText;}
 // Preserve unknown bytes for the original entire-file guard to reject.
 if(hash(source)===pin.before||!pin.added&&file!=='src/services/supabase/product-images.service.ts')return source;
 assert.fail('HANDOVER214_UNREVIEWED_SOURCE:BULK_IMAGES:'+file);
}
export function pathsBeforeBulkProductImages(files){return pathsBeforeAftercare215(files).filter(file=>{
 if(trial40IntegrationPins[file]){
  const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
  if(projectTrial40Source(file,raw,'baseline')!==raw)return false;
 }
 const pin=bulkImagePins[file];if(!pin)return true;
 assert.equal(hash(readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n')),pin.after,'BULK_IMAGES_UNREVIEWED_PATH:'+file);return false;
});}
export function restoreBulkImageSourceHashes(sources){return projectTrial40Hashes(sources,file=>bulkImagePins[file]?'bulk':'baseline').flatMap(entry=>{
 const pin=bulkImagePins[entry.file];if(!pin||entry.sha256!==pin.after)return [entry];
  const raw=projectTrial40Source(entry.file,readFileSync(new URL('../../'+entry.file,import.meta.url),'utf8'),'bulk');assert.equal(hash(raw),pin.after,'BULK_IMAGES_CURRENT_SOURCE_CHANGED');
 const before=sourceBeforeBulkProductImages(entry.file,raw);return before===null?[]:[{...entry,sha256:hash(before)}];
});}
export function projectBulkImageQuerySites(source,parseSource){
 source=projectAftercare215QuerySites(source,parseSource);
 const entries=[];
 for(const file of new Set(source.entries.map(entry=>entry.file))){
  const supplied=source.entries.filter(entry=>entry.file===file),pin=bulkImagePins[file];
  if(!pin||source.sources.find(entry=>entry.file===file)?.sha256!==pin.after){entries.push(...supplied);continue;}
  const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n'),actual=parseSource(file,raw).entries,keys=Object.keys(actual[0]??{});
  assert.deepEqual(supplied.map(entry=>Object.fromEntries(keys.map(key=>[key,entry[key]]))),actual,'BULK_IMAGES_QUERY_INVENTORY_DRIFT');
  const before=sourceBeforeBulkProductImages(file,raw),old=before===null?[]:parseSource(file,before).entries;
  // The only new direct read checks every image reference before cleanup.
  assert.equal(file,'src/services/supabase/product-images.service.ts');assert.equal(old.length,0);assert.equal(actual.length,1);assert.equal(actual[0].table,'product_images');assert.equal(actual[0].operation,'select');
 }
 return {...source,entries,sources:restoreBulkImageSourceHashes(source.sources)};
}
