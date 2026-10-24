import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

type Probe={authorized?:boolean;aal?:string;claimRole?:string;sub?:string;identityError?:boolean;claimsError?:boolean;roleError?:boolean;existingEmail?:boolean;recordError?:boolean;deleteError?:boolean};
const actor='97000000-0000-4000-8000-000000000001',target='97000000-0000-4000-8000-000000000002';
const source=readFileSync('supabase/functions/manage-staff-users/index.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(probe:Probe={}){
 let handler:(request:Request)=>Promise<Response>=()=>{throw Error('serve missing');};
 const calls:string[]=[];
 const caller={auth:{getUser:async()=>{calls.push('caller:getUser');return {data:{user:probe.identityError?null:{id:actor}},error:probe.identityError?{message:'unauthorized'}:null};},getClaims:async()=>{calls.push('caller:getClaims');return {data:{claims:{sub:probe.sub??actor,role:probe.claimRole??'authenticated',aal:probe.aal??'aal2'}},error:probe.claimsError?{message:'invalid signature'}:null};}},rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.push('caller:'+name);
  if(name==='has_erp_role'){assert.deepEqual(Array.from(args.p_allowed_roles as string[]),['owner']);return {data:probe.authorized??true,error:probe.roleError?{message:'role rejected'}:null};}
  if(name==='get_erp_staff_accounts')return {data:[{user_id:target,role_code:'cashier'}],error:null};
  if(name==='create_erp_staff_account_record'&&probe.recordError)return {data:null,error:{message:'record failed'}};
  return {data:{success:true},error:null};
 }};
 const service={auth:{admin:{createUser:async()=>{calls.push('service:createUser');return {data:{user:probe.existingEmail?null:{id:target}},error:probe.existingEmail?{message:'existing email'}:null};},deleteUser:async()=>{calls.push('service:deleteUser');return {error:probe.deleteError?{code:'cleanup_failed'}:null};},updateUserById:async()=>{calls.push('service:updateUser');return {data:{user:{id:target}},error:null};},listUsers:async()=>{calls.push('service:listUsers');return {data:{users:[{id:target,email:'staff@example.test'}]},error:null};}}}};
 runInNewContext(js,{exports:{},require:(name:string)=>{assert.equal(name,'npm:@supabase/supabase-js@2.110.8');return {createClient:(_url:string,key:string)=>{calls.push('client:'+key);return key==='anon'?caller:service;}};},Deno:{env:{get:(name:string)=>({SUPABASE_URL:'http://127.0.0.1:25431',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'}[name])},serve:(fn:typeof handler)=>{handler=fn;}},Response,console:{error:()=>{}}});
 const invoke=(action:string)=>handler(new Request('http://127.0.0.1:8000',{method:'POST',headers:{origin:'http://localhost:3000',authorization:'Bearer verified-test-token','content-type':'application/json'},body:JSON.stringify({action,userId:target,fullName:'موظف تجربة',email:'staff@example.test',password:'Example1234!',roleCode:'cashier',branchId:null,isActive:false})}));
 return {calls,invoke};
}
for(const [label,probe] of Object.entries({nonOwner:{authorized:false},inactiveOwner:{authorized:false},aal1:{aal:'aal1'},missingAal:{aal:''},wrongClaimRole:{claimRole:'service_role'},identityMismatch:{sub:target},invalidJwt:{claimsError:true},roleLookupFailure:{roleError:true},invalidIdentity:{identityError:true}})){
 test('Z1 '+label+': every action denied before service client or Auth Admin',async()=>{
  for(const action of ['create','list','audit','update','set_active','set_password','invalid']){
   const f=fixture(probe);const response=await f.invoke(action);assert.ok([401,403].includes(response.status));assert.equal(f.calls.filter(c=>c.startsWith('service:')||c==='client:service').length,0);
  }
 });
}
test('Z1 unauthorized existing/nonexisting email has the same rejection and zero service calls',async()=>{
 const a=fixture({authorized:false,existingEmail:true}),b=fixture({authorized:false,existingEmail:false});const ar=await a.invoke('create'),br=await b.invoke('create');assert.equal(ar.status,403);assert.equal(br.status,403);assert.deepEqual(await ar.json(),await br.json());assert.equal(a.calls.filter(c=>c.startsWith('service:')).length,0);assert.equal(b.calls.filter(c=>c.startsWith('service:')).length,0);
});
test('Z1 owner AAL2 is authorized by caller before all privileged operations',async()=>{
 for(const action of ['create','list','update','set_active','set_password']){const f=fixture();assert.ok([200,201].includes((await f.invoke(action)).status));const authorization=f.calls.indexOf('caller:has_erp_role'),client=f.calls.indexOf('client:service'),service=f.calls.findIndex(c=>c.startsWith('service:'));assert.ok(authorization>=0&&client>authorization&&service>client);}
});
test('Z1 orphan cleanup is only post-authorization record-failure protection',async()=>{
 for(const deleteError of [false,true]){const f=fixture({recordError:true,deleteError});assert.equal((await f.invoke('create')).status,400);assert.deepEqual(f.calls.filter(c=>c.startsWith('service:')),['service:createUser','service:deleteUser']);assert.ok(f.calls.indexOf('caller:has_erp_role')<f.calls.indexOf('service:createUser'));}
 const f=fixture();assert.equal((await f.invoke('create')).status,201);assert.ok(!f.calls.includes('service:deleteUser'));
});
