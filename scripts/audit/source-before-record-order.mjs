import{sourceBeforeOwnerTools220}from'./source-before-owner-tools220.mjs';
// Test-only exact inverse to delivered main52. Current SDK/role diagnostics
// never use it. A single unknown byte is returned unchanged to historical guards.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
export const {baseline,entries:recordOrderPins}=JSON.parse(readFileSync(new URL('./record-order-source-pins.json',import.meta.url),'utf8'));
const hash=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
const baselineText=new Map();
export function sourceBeforeRecordOrder(file,text){
 text=sourceBeforeOwnerTools220(file,text);
 if(text===null)return null;const pin=recordOrderPins[file];if(!pin||hash(text)!==pin.after)return text;
 if(pin.before===null)return null;
 let before=baselineText.get(file);
 if(before===undefined){before=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2});assert.equal(hash(before),pin.before,'RECORD_ORDER_BASELINE_DRIFT');baselineText.set(file,before);}
 return before;
}
export function restoreRecordOrderHashes(rows){return rows.flatMap(row=>{
 const pin=recordOrderPins[row.file];return !pin||pin.after!==row.sha256?[row]:pin.before===null?[]:[{...row,sha256:pin.before}];
});}
export function pathsBeforeRecordOrder(files,reference){return files.filter(file=>{
 const text=readFileSync(new URL('../../'+file,import.meta.url),'utf8'),before=sourceBeforeRecordOrder(file,text);
 if(before===null)return false;if(!reference)return true;
 try{return execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n')!==before.replaceAll('\r\n','\n');}catch{return true;}
});}
