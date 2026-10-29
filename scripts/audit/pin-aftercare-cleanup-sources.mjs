// Explicit authoring helper. Never run from CI/runtime or learn historical
// proof hashes from a database. Baseline is the exact owner-approved main.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),baseline='015ffcae98da6241514cd8ab3b646dd2993c9eb2';
assert.deepEqual(process.argv.slice(2),['--write'],'EXPLICIT_LOCAL_AUTHORING_REQUIRED');
const args=['src','customer-web/src','customer-web/scripts','customer-web/tests','package.json','docs/agent/project-state.json','.github','scripts/agent','scripts/testing','scripts/operations','scripts/backup','scripts/monitoring','scripts/offsite-backup','scripts/audit','tests','e2e','supabase/migrations/216_pos_partial_payments.sql'];
const git=flags=>execFileSync('git',['-c','core.quotepath=false',...flags],{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n');
const changed=git(['diff','--name-only',baseline,'--',...args]).trim().split('\n').filter(Boolean),added=git(['ls-files','--others','--exclude-standard','--',...args]).trim().split('\n').filter(Boolean);
const entries={},hash=text=>createHash('sha256').update(text).digest('hex');
for(const file of [...new Set([...changed,...added])].sort()){
 if(file.startsWith('docs/agent/ACTIVE_TASK')||file==='scripts/audit/aftercare-cleanup-source-pins.json')continue;
 let beforeText=null;try{beforeText=git(['show',baseline+':'+file]);}catch{/* Explicit new source, no historical body. */}
 const raw=(await readFile(path.join(root,file),'utf8')).replaceAll('\r\n','\n');entries[file]={before:beforeText===null?null:hash(beforeText),after:hash(raw),beforeText};
}
await writeFile(path.join(root,'scripts/audit/aftercare-cleanup-source-pins.json'),JSON.stringify({format:1,baseline,scope:'UI aftercare cleanup exact inverse for historical proof only;currentSDK unprojected',entries},null,2)+'\n');console.log(JSON.stringify({entries:Object.keys(entries).length,baseline}));
