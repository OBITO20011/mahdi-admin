import{sourceBeforeRecordOrder,restoreRecordOrderHashes,pathsBeforeRecordOrder}from'./source-before-record-order.mjs';
// Exact test-only projection of approved workbook/UI changes. Current inventory
// and runtime always use real sources;unknown edits are never projected away.
import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import assert from'node:assert/strict';
export const{entries}=JSON.parse(readFileSync(new URL('./product-workbook-source-pins.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeProductWorkbook(file,text){text=sourceBeforeRecordOrder(file,text);if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=entries[file];if(!pin||hash(raw)!==pin.after)return raw;if(pin.beforeText===null)return null;assert.equal(hash(pin.beforeText),pin.before,'PRODUCT_WORKBOOK_INVERSE_CORRUPT');return pin.beforeText;}
export function restoreProductWorkbookHashes(rows){return restoreRecordOrderHashes(rows).flatMap(e=>{const p=entries[e.file];if(!p||p.after!==e.sha256)return[e];return p.beforeText===null?[]:[{...e,sha256:p.before}];});}
export function pathsBeforeProductWorkbook(files,reference){return pathsBeforeRecordOrder(files,reference).filter(file=>{const actual=sourceBeforeRecordOrder(file,readFileSync(new URL('../../'+file,import.meta.url),'utf8'));if(actual===null)return false;const p=entries[file];if(!p||hash(actual.replaceAll('\r\n','\n'))!==p.after)return true;if(p.beforeText===null)return false;if(!reference)return true;let old=null;try{old=execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n');}catch{/* File absent in the exact reference. */}return old!==p.beforeText;});}

