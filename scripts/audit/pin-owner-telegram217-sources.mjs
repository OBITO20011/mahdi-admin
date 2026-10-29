// Explicit authoring only; never learns historical proof from a database.
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),baseline='5a50320fea2f30c36f8b784164c97a4aa270220d';assert.deepEqual(process.argv.slice(2),['--write']);
const git=args=>execFileSync('git',['-c','core.quotepath=false',...args],{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n');
const hash=s=>createHash('sha256').update(s).digest('hex'),scope=['src','customer-web/src','customer-web/scripts','customer-web/tests','package.json','docs/agent/project-state.json','.github','scripts','tests','e2e','supabase'];
const files=[...new Set([...git(['diff','--name-only',baseline,'--',...scope]).trim().split('\n'),...git(['ls-files','--others','--exclude-standard','--',...scope]).trim().split('\n')].filter(Boolean))].sort(),entries={};
for(const file of files){if(file.startsWith('docs/agent/ACTIVE_TASK')||file==='scripts/audit/owner-telegram217-source-pins.json')continue;
 let beforeText=null;try{beforeText=git(['show',baseline+':'+file]);}catch{/* Explicit new source. */}
 const text=(await readFile(path.join(root,file),'utf8')).replaceAll('\r\n','\n');entries[file]={before:beforeText===null?null:hash(beforeText),after:hash(text),beforeText};
}
await writeFile(path.join(root,'scripts/audit/owner-telegram217-source-pins.json'),JSON.stringify({format:1,baseline,scope:'Owner217 exact inverse for historical proof only;currentSDK/Edge unprojected',entries},null,2)+'\n');console.log(JSON.stringify({entries:Object.keys(entries).length,baseline}));
