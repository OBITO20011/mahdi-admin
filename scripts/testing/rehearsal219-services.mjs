// Execute unmodified UI services/parsers. Only Supabase's I/O boundary is replaced
// by the same loopback-free Docker executor; every RPC still runs in PostgreSQL
// as authenticated / original owner UUID / AAL2, never as a service-role writer.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {sqlLiteral as q} from '../operations/trial-reset-core.mjs';
const allowed=new Set(['get_go_live_setup_status_v1','import_go_live_products_v1','record_customer_opening_balances_v1',
 'record_supplier_opening_balances_v1','finish_go_live_setup_v1','set_go_live_main_branch_v1','get_inventory_opening_setup','apply_inventory_opening_setup',
 'preview_go_live_cheques_v1','record_go_live_cheques_v1','create_product_family_with_flavors_v2','create_product_flavor_v1',
 'get_go_live_customer_openings_v1','get_go_live_supplier_openings_v1','get_cash_shift_summary','get_cash_shift_closing_report',
 'open_cash_shift','close_cash_shift','create_pos_sale_v2','create_pos_sale_with_initial_payment_v1','get_home_dashboard']);
export async function rehearsal219Services({sql,ownerId,output,root}){
 const json=async text=>JSON.parse(await sql(text));
 assert.equal(await sql(`SELECT EXISTS(SELECT 1 FROM auth.users u JOIN auth.mfa_factors f ON f.user_id=u.id WHERE u.id=${q(ownerId)}::uuid AND f.status='verified');`),'t','REHEARSAL_ORIGINAL_OWNER_MFA_REQUIRED');
 const asOwner=text=>`BEGIN;DO $identity$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:ownerId,role:'authenticated',aal:'aal2'}))},true);END $identity$;SET LOCAL ROLE authenticated;${text};COMMIT;`;
 const calls=[];
 const rpc=async(name,args={})=>{
  assert.ok(allowed.has(name),'REHEARSAL_RPC_NOT_ALLOWED');
  const matches=await json(`SELECT coalesce(jsonb_agg(jsonb_build_object('names',proargnames,'types',(SELECT jsonb_agg(format_type(t,NULL) ORDER BY n) FROM unnest(proargtypes) WITH ORDINALITY a(t,n)))),'[]') FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND proname=${q(name)};`);
  const candidates=matches.filter(m=>Object.keys(args).every(k=>m.names?.includes(k)));
  assert.equal(candidates.length,1,'REHEARSAL_RPC_SIGNATURE_AMBIGUOUS');const m=candidates[0];
  const parameters=Object.entries(args).map(([key,value])=>{
   assert.match(key,/^p_[a-z0-9_]+$/u);const type=m.types[m.names.indexOf(key)];assert.ok(type);
   return `${key}:=${value===null?'NULL':q(typeof value==='object'?JSON.stringify(value):String(value))}::${type}`;
  });
  calls.push(name);
  return {data:await json(asOwner(`SELECT public.${name}(${parameters.join(',')})`)),error:null};
 };
 const client={rpc,auth:{getSession:async()=>({data:{session:{user:{id:ownerId}}},error:null})},
  from:table=>{
   assert.ok(['units','categories','warehouses'].includes(table),'REHEARSAL_TABLE_QUERY_NOT_ALLOWED');
   const filters=[];let columns='*',limit=1;
   const query={select:value=>{assert.match(value,/^(?:\*|[a-z_]+(?:,[a-z_]+)*)$/u);columns=value;return query;},
    eq:(field,value)=>{assert.match(field,/^[a-z_]+$/u);filters.push(`${field}=${typeof value==='boolean'?String(value):q(value)}`);return query;},
    limit:value=>{assert.equal(value,1);limit=value;return query;},
    then:(resolve,reject)=>json(asOwner(`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM (SELECT ${columns} FROM public.${table}${filters.length?' WHERE '+filters.join(' AND '):''} LIMIT ${limit}) t`)).then(data=>resolve({data,error:null}),reject)};
   return query;
  }};
 const globalKey='__nawasrahRehearsal219Services';assert.equal(globalThis[globalKey],undefined);
 globalThis[globalKey]=client;
 const entry=`export * as goLive from './src/services/supabase/goLive.service.ts';
 export * as importer from './src/features/goLive/goLiveImport.ts';export * as xlsx from './src/lib/xlsx.ts';
 export * as inventory from './src/services/supabase/inventory-opening.service.ts';
 export * as products from './src/services/supabase/products.service.ts';
 export * as cheques from './src/services/supabase/openingCheques.service.ts';
 export * as chequeImport from './src/features/goLive/openingChequesImport.ts';`;
 const bundle=path.join(output,'actual-ui-services.mjs');
 try{
  await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent',
   plugins:[{name:'local-docker-transport-only',setup(b){b.onResolve({filter:/[\\/]lib[\\/]supabase(?:\.ts)?$/},()=>({path:'local-only',namespace:'rehearsal'}));
    b.onLoad({filter:/.*/,namespace:'rehearsal'},()=>({contents:`export const supabase=globalThis.${globalKey};export const isSupabaseConfigured=true;` }));}}]});
  const modules=await import(pathToFileURL(bundle).href);
  return {...modules,rpc,calls,close:()=>{delete globalThis[globalKey];}};
 }catch(error){delete globalThis[globalKey];throw error;}
}
