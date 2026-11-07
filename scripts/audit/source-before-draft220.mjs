import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
export function sourceBeforeDraft220Workflow(text){
 if(hash(text)!=="27814f474e4c2d695cabc3b786fec8bcc96ff20e846b097941882353b181db5e")return text;
 const old=execFileSync('git',['show',"01d4b036136304876da1be8b701cff9e342e3b4d:.github/workflows/quality.yml"],{encoding:'utf8',windowsHide:true});
 assert.equal(hash(old),"1cb00b274ee52e86b8889d31507c11be67d8e6f5f2efa7d34d8284ee6fb2f52b");return old.replaceAll('\r\n','\n');
}
