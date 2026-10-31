import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const guide=read('docs/MAINTAINER_GUIDE_AR.md');
type Token={value:string; kind:'word'|'opaque'|'punct'; anonymousBody?:string};

// Test-only DDL reader. Bodies/strings/comments are opaque: a fake CREATE in a
// comment or PL/pgSQL string cannot make a nonexistent public RPC look present.
function tokens(sql:string):Token[]{
  const out:Token[]=[];
  for(let at=0;at<sql.length;){
    const rest=sql.slice(at);
    const space=/^\s+/u.exec(rest);if(space){at+=space[0].length;continue;}
    if(rest.startsWith('--')){const end=sql.indexOf('\n',at);at=end<0?sql.length:end;continue;}
    if(rest.startsWith('/*')){let depth=1;at+=2;while(at<sql.length&&depth){if(sql.startsWith('/*',at)){depth++;at+=2;}else if(sql.startsWith('*/',at)){depth--;at+=2;}else at++;}assert.equal(depth,0,'Unclosed SQL comment');continue;}
    const dollar=/^\$(?:[a-z_][a-z_0-9]*)?\$/iu.exec(rest);
    if(dollar){const end=sql.indexOf(dollar[0],at+dollar[0].length);assert.ok(end>=0,'Unclosed SQL body');out.push({value:'',kind:'opaque',anonymousBody:sql.slice(at+dollar[0].length,end)});at=end+dollar[0].length;continue;}
    const quote=sql[at];
    if(quote==="'"||quote==='"'){
      at++;let value='',closed=false;
      while(at<sql.length){const c=sql[at++];if(c===quote){if(sql[at]===quote){value+=c;at++;}else{closed=true;break;}}else if(c==='\\'&&quote==="'"){at++;}else value+=c;}
      assert.ok(closed,'Unclosed SQL quote');out.push({value:quote==='"'?value.toLowerCase():'',kind:quote==='"'?'word':'opaque'});continue;
    }
    const word=/^[a-z_][a-z_0-9$]*/iu.exec(rest);if(word){out.push({value:word[0].toLowerCase(),kind:'word'});at+=word[0].length;continue;}
    out.push({value:sql[at++],kind:'punct'});
  }
  // Anonymous DO may contain literal DDL (e.g. migration012 renames).
  // EXECUTE strings remain opaque; function bodies are never expanded.
  return out.flatMap((token,at)=>out[at-1]?.value==='do'&&token.anonymousBody!==undefined?tokens(token.anonymousBody):[token]);
}
type Definition={file:string; declaredIn:string; renamedFrom?:string};
function currentFunctions(files:{file:string;sql:string}[]):Map<string,Definition>{
  const current=new Map<string,Definition>();
  for(const {file,sql}of files){const t=tokens(sql),value=(at:number)=>t[at]?.value;
    for(let at=0;at<t.length;at++){
      const action=value(at);let cursor=at+1;
      if(action==='create'&&value(cursor)==='or'&&value(cursor+1)==='replace')cursor+=2;
      if(!['create','alter','drop'].includes(action)||value(cursor)!=='function')continue;
      cursor++;if(action==='drop'&&value(cursor)==='if'&&value(cursor+1)==='exists')cursor+=2;
      let schema='public',name=value(cursor++);if(value(cursor)==='.'){schema=name;name=value(++cursor);cursor++;}
      if(schema!=='public'||!name||value(cursor)!=='(')continue;
      if(action==='create'){current.set(name,{file,declaredIn:file});continue;}
      let depth=0;do{if(value(cursor)==='(')depth++;else if(value(cursor)===')')depth--;cursor++;}while(cursor<t.length&&depth>0);
      if(action==='drop'){current.delete(name);continue;}
      if(value(cursor)==='rename'&&value(cursor+1)==='to'){
        const to=value(cursor+2),old=current.get(name);assert.ok(old,`Rename source missing:${name}@${file}`);
        current.delete(name);current.set(to,{...old,file,renamedFrom:name});
      }
    }
  }
  return current;
}
const migrations=readdirSync(path.join(root,'supabase/migrations')).filter(f=>/^\d{3}_.+\.sql$/u.test(f)).sort();
const functions=currentFunctions(migrations.map(file=>({file,sql:read('supabase/migrations/'+file)})));
const tableNames=new Set<string>();
for(const file of migrations){const t=tokens(read('supabase/migrations/'+file));
  for(let at=0;at<t.length;at++){
    if(t[at].value!=='create'||t[at+1]?.value!=='table')continue;
    let cursor=at+2;if(t[cursor]?.value==='if')cursor+=3;
    const first=t[cursor]?.value;
    if(t[cursor+1]?.value==='.'){
      if(first==='public')tableNames.add(t[cursor+2]?.value);
    }else if(first)tableNames.add(first);
  }
}
const references=new Map([...guide.matchAll(/^\[m(\d{3})\]: \.\.\/supabase\/migrations\/(\d{3}_.+\.sql)$/gmu)].map(m=>[m[1],m[2]]));
const section=guide.split('<!-- operations:start -->')[1]?.split('<!-- operations:end -->')[0];
assert.ok(section,'Maintainer operation table required');
const rows=section.split('\n').filter(line=>line.startsWith('| ')&&!line.startsWith('| العملية'));
const expand=(file:string)=>{
  const prefixes:Record<string,string>={'F/':'src/features/','S/':'src/services/supabase/','T/':'scripts/testing/','U/':'tests/'};
  const prefix=Object.keys(prefixes).find(p=>file.startsWith(p));return prefix?prefixes[prefix]+file.slice(prefix.length):file;
};
const code=(cell:string)=>[...cell.matchAll(/`([^`]+)`/gu)].map(m=>m[1]);
function validateRpc(name:string,file:string){
  assert.ok(functions.has(name),'DOCUMENTED_RPC_NOT_CURRENT:'+name);
  assert.equal(functions.get(name)!.file,file,'DOCUMENTED_RPC_DEFINITION_STALE:'+name);
}

test('maintainer RPC map points to live names and their last actual CREATE/RENAME migration',()=>{
  assert.ok(rows.length>=30,'Every operational family needs a row');
  const names=new Set<string>();
  for(const row of rows){const cells=row.split('|').slice(1,-1).map(c=>c.trim());assert.equal(cells.length,6,row);
    for(const file of [...code(cells[1]),...code(cells[2]),...code(cells[5])])assert.ok(existsSync(path.join(root,expand(file))),file);
    const callers=code(cells[2]).map(file=>read(expand(file))).join('\n');
    for(const table of code(cells[4]))assert.ok(tableNames.has(table),'Documented table lacks an actual SQL declaration:'+table);
    const matches=[...cells[3].matchAll(/`([a-z_][a-z_0-9]*)` \(\[(\d{3}_[^\]]+\.sql)\]\[m(\d{3})\]\)/gu)];
    assert.ok(matches.length,'Every operation needs an exact RPC+definition pair:'+cells[0]);
    for(const [,name,file,number]of matches){assert.equal(references.get(number),file);assert.equal(file.slice(0,3),number);validateRpc(name,file);names.add(name);assert.ok(callers.includes("'"+name+"'")||callers.includes('"'+name+'"'),'RPC is absent from documented caller:'+name);}
  }
  assert.ok(names.size>=65,'Do not silently remove current lifecycle/financial entries');
});

test('SQL consistency reader fails closed on comments, quoted bodies, renamed and dropped names',()=>{
  const f=currentFunctions([
    {file:'001_a.sql',sql:`-- CREATE FUNCTION public.fake() RETURNS void AS $$ $$ LANGUAGE sql;
      /* nested /* CREATE FUNCTION public.nope() */ comment */
      CREATE FUNCTION public.real() RETURNS void AS $body$ BEGIN RAISE NOTICE 'CREATE FUNCTION public.fake2()'; END $body$ LANGUAGE plpgsql;
      DO $$ BEGIN EXECUTE 'CREATE FUNCTION public.fake3()'; END $$;`},
    {file:'002_b.sql',sql:'DO $$ BEGIN ALTER FUNCTION public.real() RENAME TO internal_old; END $$; CREATE FUNCTION public.real() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql;'},
    {file:'003_c.sql',sql:'DROP FUNCTION public.real();'},
  ]);
  assert.deepEqual([...f.keys()],['internal_old']);assert.equal(f.get('internal_old')?.file,'002_b.sql');assert.equal(f.get('internal_old')?.declaredIn,'001_a.sql');
  assert.throws(()=>validateRpc('not_a_real_rpc','001_a.sql'),/DOCUMENTED_RPC_NOT_CURRENT/u);
  assert.throws(()=>validateRpc('create_pos_sale_v2','112_old.sql'),/DOCUMENTED_RPC_DEFINITION_STALE/u);
});

test('guide stays discoverable, linked, ceiling-bound and names-only for configuration',()=>{
  for(const file of ['README.md','AGENTS.md','docs/agent/PROJECT_OVERVIEW.md'])assert.ok(read(file).includes('MAINTAINER_GUIDE_AR.md'),file);
  for(const m of guide.matchAll(/(?<!!)\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)/gu)){if(m[1].startsWith('https:'))continue;assert.ok(existsSync(path.resolve(root,'docs',m[1])),'Guide link missing:'+m[1]);}
  const state=JSON.parse(read('docs/agent/project-state.json'));assert.ok(guide.includes('**'+state.migrationCeiling+' / '+migrations.length+' ملف migration**'));
  const admin=JSON.parse(read('package.json')),store=JSON.parse(read('customer-web/package.json'));for(const n of ['build:production','build:staging','build:prelaunch-trial']){assert.ok(admin.scripts[n]);assert.ok(store.scripts[n]);}
  const secretSection=guide.split('## 4.')[1].split('## 5.')[0];
  assert.doesNotMatch(secretSection,/https?:\/\/|sb_(?:publishable|secret)_|eyJ[A-Za-z0-9_-]{10}|-----BEGIN|(?:TOKEN|PASSWORD|DSN|SECRET|PASSPHRASE)\s*=\s*[^\s|]+/u);
  for(const label of ['StoreEngine','useSyncExternalStore','ليس','M01','WAC','Asia/Amman','junction','service_role','Gitleaks','verify-only','--resume','الدفتر الورقي','قبل التوظيف'])assert.ok(guide.includes(label),label);
});
