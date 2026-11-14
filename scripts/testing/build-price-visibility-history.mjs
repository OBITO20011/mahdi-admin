// Exact small literal inverses,not snapshots of multi-MB runtime evidence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';
const baseline='0bd3b5b0fd149c9e92d802c6dabb55b236c127cc',output='scripts/audit/price-visibility-source-pin.json';
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2});
const pin=JSON.parse(readFileSync(output,'utf8')),files={};
assert.ok(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--check');
const paths=[...new Set([...git(['diff','--name-only','-z',baseline]).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')])].filter(Boolean).sort();
for(const file of paths){
 if(file===output||file.startsWith('docs/agent/')||file.startsWith('.env'))continue;
 const raw=readFileSync(file),binary=/\.png$/u.test(file),after=binary?raw:canonicalLf(raw.toString('utf8'));
 let before=null;try{before=canonicalLf(git(['show',baseline+':'+file]));}catch{/* New exact artifact. */}
 if(before===after)continue;
 const entry={before:before===null?null:sha256(before),after:sha256(after),...(binary?{binary:true}:{}),hunks:[]};
 if(before!==null){
  assert.equal(binary,false,'EXISTING_BINARY_EDIT_FORBIDDEN');
  const lines=canonicalLf(git(['diff','--no-ext-diff','--unified=3',baseline,'--',file])).split('\n');
  let hunk=null;
  for(const line of lines){
   if(line.startsWith('@@')){
    const start=Number(line.match(/\+(\d+)/u)[1]);
    hunk={before:'',after:'',offset:after.split('\n').slice(0,start-1).reduce((n,s)=>n+s.length+1,0)};
    entry.hunks.push(hunk);continue;
   }
   if(!hunk||line.startsWith('\\'))continue;
   if(line.startsWith(' ')||line.startsWith('-'))hunk.before+=line.slice(1)+'\n';
   if(line.startsWith(' ')||line.startsWith('+'))hunk.after+=line.slice(1)+'\n';
  }
  let restored=after;
  for(const hunk of [...entry.hunks].reverse()){
   assert.equal(restored.slice(hunk.offset,hunk.offset+hunk.after.length),hunk.after,'LITERAL_HUNK_POSITION_DIFFERS:'+file);
   restored=restored.slice(0,hunk.offset)+hunk.before+restored.slice(hunk.offset+hunk.after.length);
  }
  assert.equal(restored,before,'LITERAL_INVERSE_DIFFERS:'+file);
 }
 files[file]=entry;
}
const text=JSON.stringify({...pin,baseline,files},null,2)+'\n';
if(process.argv.includes('--check'))assert.equal(readFileSync(output,'utf8'),text,'PRICE_HISTORY_REFRESH_REQUIRED');
else writeFileSync(output,text);
console.log(JSON.stringify({ok:true,files:Object.keys(files).length,checkOnly:process.argv.includes('--check')}));
