import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {json,save,output,assertLocal212} from './context.mjs';
await assertLocal212();
const inventory=JSON.parse(await readFile(path.join(output,'exposure.json'),'utf8'));
const bodies=await json("SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'name',p.proname,'result',pg_get_function_result(p.oid),'body',pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f';");
const triggers=await json("SELECT jsonb_agg(jsonb_build_object('function',p.proname,'table',c.relname,'trigger',t.tgname)) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND p.pronamespace='public'::regnamespace;");
const rows=inventory.functions.filter(f=>f.reviewRequired).map(f=>({signature:f.signature,name:f.name,roles:f.roles,returnType:bodies.find(b=>b.signature===f.signature)?.result,sqlCallCandidates:bodies.filter(b=>b.signature!==f.signature&&new RegExp('\\b'+f.name+'\\s*\\(','u').test(b.body)).map(b=>b.signature),triggers:triggers.filter(t=>t.function===f.name),policyCandidates:inventory.relations.flatMap(r=>(r.policies??[]).filter(p=>new RegExp('\\b'+f.name+'\\s*\\(','u').test((p.using??'')+(p.check??''))).map(p=>({table:r.name,policy:p.name})))}));
await save('exposure-dependencies',{rows,staticCandidatesOnly:true,managedAccess:false});console.log(JSON.stringify({rows:rows.length,triggers:rows.filter(r=>r.returnType==='trigger').length}));
