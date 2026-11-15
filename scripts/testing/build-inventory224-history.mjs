import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';

const root=new URL('../../',import.meta.url);
const baseline='3b35a263f7c20212c537bb61b2d20af778b7613d';
const output=new URL('scripts/audit/inventory224-source-pins.json',root);
const check=process.argv[2]==='--check';
assert.ok(process.argv.length===2||process.argv.length===3&&check,'ONLY_CHECK_OPTION');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:64*1024**2});
// Pin exact reviewed sources, including old tools; omit only this generated
// index and transient checkpoints. Unknown bytes never acquire a projection.
const relevant=file=>Boolean(file)&&file!=='scripts/audit/inventory224-source-pins.json'&&
 !file.startsWith('docs/agent/ACTIVE_TASK')&&!file.startsWith('.env')&&
 /\.(?:[cm]?[jt]sx?|md|json|yml|yaml|html|ps1|sql|css)$/u.test(file);
const paths=[...new Set([...git(['diff','--name-only','-z',baseline]).split('\0'),
 ...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(relevant))].sort();
const entries={};
for(const file of paths){
 const afterText=canonicalLf(readFileSync(new URL(file,root),'utf8'));
 let beforeText=null;
 try{beforeText=canonicalLf(git(['show',baseline+':'+file]));}catch{/* New reviewed path. */}
 const before=beforeText===null?null:sha256(beforeText),after=sha256(afterText);
 if(before!==after)entries[file]={before,after,beforeText};
}
const result=JSON.stringify({format:1,baseline,entries},null,2)+'\n';
if(check)assert.equal(canonicalLf(readFileSync(output,'utf8')),result,'INVENTORY224_HISTORY_REFRESH_REQUIRED');
else writeFileSync(output,result);
console.log(JSON.stringify({ok:true,checkOnly:check,files:Object.keys(entries).length}));
