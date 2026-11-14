// Local source commitments only; no database, env values or hosted access.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';
const root=new URL('../../',import.meta.url),baseline='bd4d696af6eef074bfd523ee54906059a0bb668c';
const output='scripts/audit/independent-prices222-source-pins.json';
assert.ok(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--check','ONLY_CHECK_OPTION');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2});
const paths=[...new Set([...git(['diff','--name-only','-z',baseline]).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort();
const previous=JSON.parse(readFileSync(new URL(output,root),'utf8')),entries={};
for(const file of paths){
 if(file===output||file.startsWith('docs/agent/ACTIVE_TASK')||file.startsWith('.env'))continue;
 assert.match(file,/\.(?:[cm]?[jt]sx?|md|json|yml|yaml|html|ps1|sql|css)$/u,'TEXT_SOURCE_PIN_SCOPE:'+file);
 assert.ok(existsSync(new URL(file,root)),'DELETED_SOURCE_REQUIRES_EXPLICIT_HISTORY:'+file);
 const afterText=canonicalLf(readFileSync(new URL(file,root),'utf8'));let beforeText=null;
 try{beforeText=canonicalLf(git(['show',baseline+':'+file]));}catch{/* Exactly new path. */}
 const pin={before:beforeText===null?null:sha256(beforeText),after:sha256(afterText),beforeText};
 if(pin.before===pin.after)continue;
 if(previous.entries[file]){assert.equal(pin.before,previous.entries[file].before,'PRICES222_IMMUTABLE_BEFORE:'+file);assert.equal(pin.beforeText,previous.entries[file].beforeText,'PRICES222_IMMUTABLE_BEFORE_TEXT:'+file);}
 entries[file]=pin;
}
const text=JSON.stringify({format:1,baseline,entries},null,2)+'\n';
if(process.argv.includes('--check'))assert.equal(readFileSync(new URL(output,root),'utf8'),text,'PRICES222_HISTORY_REFRESH_REQUIRED');
else writeFileSync(new URL(output,root),text);
console.log(JSON.stringify({ok:true,checkOnly:process.argv.includes('--check'),files:Object.keys(entries).length,beforeTextPreserved:true}));
