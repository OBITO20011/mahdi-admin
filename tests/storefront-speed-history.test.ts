import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sourceBeforeStorefrontSpeed,restoreStorefrontSpeedHashes} from '../scripts/audit/source-before-storefront-speed.mjs';
const hash=(text:string)=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
test('speed history is bound to exact delivered Git bytes and preserves every unknown mutation',()=>{
 const pins=JSON.parse(readFileSync('scripts/audit/storefront-speed-source-pins.json','utf8'));
 assert.equal(pins.baseline,'87f29abad10718bd533a6f9f0789194d967ee0f3');
 for(const[file,pin]of Object.entries(pins.entries)as[string,{before:string|null;after:string}][]){
  const current=readFileSync(file,'utf8');assert.equal(hash(current),pin.after,file);
  const before=sourceBeforeStorefrontSpeed(file,current);
  if(pin.before===null)assert.equal(before,null,file);else{const actual=execFileSync('git',['show',pins.baseline+':'+file],{encoding:'utf8',maxBuffer:32*1024**2});assert.equal(hash(actual),pin.before);assert.equal(hash(before!),pin.before);}
  const mutated=current+'\n// unknown mutation\n';assert.equal(sourceBeforeStorefrontSpeed(file,mutated),mutated,file);
 }
 assert.deepEqual(restoreStorefrontSpeedHashes([{file:'unknown',sha256:'unapproved'}]),[{file:'unknown',sha256:'unapproved'}]);
});
