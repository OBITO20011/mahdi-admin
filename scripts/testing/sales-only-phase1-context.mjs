import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export const project='nawasrah-sales-lite1-test';
export const container='supabase_db_'+project;
export function localContext(expectedId) {
 assert.match(expectedId,/^[0-9a-f]{64}$/u,'OWNED_CONTAINER_ID_REQUIRED');
 const inspect=()=>JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
 const assertOwned=()=>{const c=inspect();assert.equal(c.Id,expectedId);assert.equal(c.Name,'/'+container);assert.equal(c.Config.Labels['com.supabase.cli.project'],project);assert.deepEqual(Object.keys(c.NetworkSettings.Networks),[],'NO_NETWORK_ALLOWED');};
 assertOwned();const executor=executorFor(['--container',container]);
 const sql=async text=>{assertOwned();const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
 const json=async text=>JSON.parse((await sql(text)).split('\n').at(-1));
 const q=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
 const j=v=>q(JSON.stringify(v))+'::jsonb';
 const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const auth=(text,uid=id(1),role='authenticated',aal='aal2')=>`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:uid,role,aal})}::text,true);SET LOCAL ROLE ${role};${text}COMMIT;`;
 const rpc=(call,uid=id(1),role='authenticated',aal='aal2')=>json(auth('SELECT public.'+call+';',uid,role,aal));
 const fingerprint=async()=>({public:await readApplicationFingerprint(executor),private:await json(`SELECT jsonb_build_object('requests',(SELECT jsonb_agg(to_jsonb(x) ORDER BY key) FROM sales_lite1.requests x),'orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY order_id) FROM sales_lite1.orders x),'completions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY order_id) FROM sales_lite1.completions x),'returns',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM sales_lite1.returns x),'availability',(SELECT jsonb_agg(to_jsonb(x) ORDER BY product_id) FROM sales_lite1.availability x));`)});
 const rejectSql=async(text,pattern)=>{assertOwned();const r=await executeInput(executor,text);assert.notEqual(r.code,0);assert.match(r.stderr,pattern);};
 const fail=async(call,pattern,uid=id(1),role='authenticated',aal='aal2')=>{await rejectSql(auth('SELECT public.'+call+';',uid,role,aal),pattern);};
 return {assertOwned,executor,sql,json,q,j,id,auth,rpc,fail,rejectSql,fingerprint};
}
