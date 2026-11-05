import{sourceBeforeStorefrontSpeed,restoreStorefrontSpeedHashes,pathsBeforeStorefrontSpeed}from'./source-before-storefront-speed.mjs';
import{sourceBeforeStorefrontImages,restoreStorefrontImagesHashes,pathsBeforeStorefrontImages}from'./source-before-storefront-images.mjs';
import{sourceBeforeIphoneDialogs,restoreIphoneDialogHashes,pathsBeforeIphoneDialogs}from'./source-before-iphone-dialogs.mjs';
import{sourceBeforeRecordOrder,restoreRecordOrderHashes,pathsBeforeRecordOrder}from'./source-before-record-order.mjs';
import{sourceBeforeProductScale}from'./source-before-product-scale.mjs';
// Exact test-only projection of approved workbook/UI changes. Current inventory
// and runtime always use real sources;unknown edits are never projected away.
import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import assert from'node:assert/strict';
export const{entries}=JSON.parse(readFileSync(new URL('./product-workbook-source-pins.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
// The new branch field is known by exact bytes; all other historical sources
// still use the original reviewed presentation/workbook projections.
export const sourceBeforeMobilePresentation=(file,text)=>{text=sourceBeforeStorefrontSpeed(file,sourceBeforeStorefrontImages(file,text));return sourceBeforeIphoneDialogs(file,sourceBeforeRecordOrder(file,file==='docs/agent/project-state.json'?sourceBeforeProductScale(file,text):text));};
export function sourceBeforeProductWorkbook(file,text){text=sourceBeforeMobilePresentation(file,text);if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=entries[file];if(!pin||hash(raw)!==pin.after)return raw;if(pin.beforeText===null)return null;assert.equal(hash(pin.beforeText),pin.before,'PRODUCT_WORKBOOK_INVERSE_CORRUPT');return pin.beforeText;}
export function restoreProductWorkbookHashes(rows){return restoreIphoneDialogHashes(restoreRecordOrderHashes(restoreStorefrontSpeedHashes(restoreStorefrontImagesHashes(rows)))).flatMap(e=>{const p=entries[e.file];if(!p||p.after!==e.sha256)return[e];return p.beforeText===null?[]:[{...e,sha256:p.before}];});}
export function pathsBeforeProductWorkbook(files,reference){return pathsBeforeIphoneDialogs(pathsBeforeRecordOrder(pathsBeforeStorefrontSpeed(pathsBeforeStorefrontImages(files,reference),reference),reference),reference).filter(file=>{const actual=sourceBeforeMobilePresentation(file,readFileSync(new URL('../../'+file,import.meta.url),'utf8'));if(actual===null)return false;const p=entries[file];if(!p||hash(actual.replaceAll('\r\n','\n'))!==p.after)return true;if(p.beforeText===null)return false;if(!reference)return true;let old=null;try{old=execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n');}catch{/* File absent in the exact reference. */}return old!==p.beforeText;});}

