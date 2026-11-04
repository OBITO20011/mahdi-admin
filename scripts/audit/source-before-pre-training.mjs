import{sourceBeforeProductWorkbook,restoreProductWorkbookHashes,pathsBeforeProductWorkbook}from'./source-before-product-workbook.mjs';
// Exact presentation-only historical projection; current runtime always reads real sources.
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const {entries}=JSON.parse(readFileSync(new URL('./pre-training-source-pins.json',import.meta.url),'utf8'));
const hash=text=>createHash('sha256').update(text).digest('hex');
export function sourceBeforePreTraining(file,text){
 text=sourceBeforeProductWorkbook(file,text);if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=entries[file];
 if(!pin||hash(raw)!==pin.after)return raw;if(pin.beforeText===null)return null;
 assert.equal(hash(pin.beforeText),pin.before,'PRETRAINING_INVERSE_CORRUPT');return pin.beforeText;
}
export function restorePreTrainingHashes(sources){return restoreProductWorkbookHashes(sources).flatMap(entry=>{
 const pin=entries[entry.file];if(!pin||entry.sha256!==pin.after)return[entry];
 return pin.beforeText===null?[]:[{...entry,sha256:pin.before}];
});}
export function pathsBeforePreTraining(files,reference){return pathsBeforeProductWorkbook(files,reference).filter(file=>{
 const pin=entries[file];if(!pin||hash(sourceBeforeProductWorkbook(file,readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n'))??'')!==pin.after)return true;
 if(pin.beforeText===null)return false;if(!reference)return true;
 let historical=null;try{historical=execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n');}catch{/* Absent at exact historical reference. */}
 return historical!==pin.beforeText;
});}
