// Literal source view for this presentation-only package; never a DB admission rule.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';
const root=new URL('../../',import.meta.url),baseline='99eb18465d828b404764a18f1ff212f793e3fcc3';
const output='scripts/audit/latin-digits-source-pins.json',check=process.argv[2]==='--check';
assert.ok(process.argv.length===2||process.argv.length===3&&check,'ONLY_CHECK_OPTION');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:128*1024**2});
const paths=[...new Set([...git(['diff','--name-only','-z',baseline]).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort();
let previous;try{previous=JSON.parse(readFileSync(new URL(output,root),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const entries={};
for(const file of paths){
 if(file===output||file.startsWith('docs/agent/ACTIVE_TASK')||file.startsWith('.env'))continue;
 assert.ok(!file.startsWith('supabase/migrations/'),'LATIN_DIGITS_NO_SQL');
 assert.match(file,/\.(?:[cm]?[jt]sx?|md|json|yml|yaml|html|css|ps1|png)$/u,'REVIEWED_TEXT_OR_SCREENSHOT_ONLY:'+file);
 const binary=file.endsWith('.png'),raw=readFileSync(new URL(file,root)),text=binary?raw:canonicalLf(raw.toString('utf8'));
 let beforeText=null;try{beforeText=canonicalLf(git(['show',baseline+':'+file]));}catch{/* New approved presentation/test path. */}
 if(binary)assert.equal(beforeText,null,'EXISTING_BINARY_EDIT_NOT_IN_SCOPE');
 const before=beforeText===null?null:sha256(beforeText),after=sha256(text);if(before===after)continue;
 if(previous?.entries[file]){assert.equal(before,previous.entries[file].before,'IMMUTABLE_LATIN_BEFORE:'+file);assert.equal(beforeText,previous.entries[file].beforeText,'IMMUTABLE_LATIN_BEFORE_TEXT:'+file);}
 entries[file]={before,after,beforeText,...(binary?{binary:true}:{})};
}
const text=JSON.stringify({format:1,baseline,entries},null,2)+'\n';
if(check)assert.equal(canonicalLf(readFileSync(new URL(output,root),'utf8')),text,'LATIN_SOURCE_REFRESH_REQUIRED');
else writeFileSync(new URL(output,root),text);
console.log(JSON.stringify({ok:true,checkOnly:check,files:Object.keys(entries).length,beforeTextPreserved:true}));
