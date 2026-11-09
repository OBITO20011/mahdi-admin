import test from 'node:test';
import assert from 'node:assert/strict';
import {parseServices,serviceInventory} from '../scripts/audit/service-access-inventory.mjs';

const resolve=(source:string)=>parseServices('src/example.ts',source).rpc[0]?.resolutions?.map((r:{name:string})=>r.name);
test('RPC inventory preserves every literal branch and actual local callback invocation',()=>{
 assert.deepEqual(resolve("client.rpc(mode?'lite':'full',{});"),['lite','full']);
 assert.deepEqual(resolve("client.rpc(mode?'lite':(other?'old':'older'),{});"),['lite','old','older']);
 assert.deepEqual(resolve("function read(id,execute){execute('lite',{});if(old)execute('full',{});}read(id,(name,args)=>client.rpc(name,args));"),['lite','full']);
 assert.deepEqual(resolve("async function read(execute){return execute(mode?'lite':'full',{});}read((name,args)=>client.rpc(name,args));"),['lite','full']);
});
test('unbounded branches, shadowing, mutation and escaping callbacks never certify a subset',()=>{
 const invalid=[
  "client.rpc(mode?'lite':unknown,{});",
  "const name: 'lite'|'full'=external;client.rpc(name,{});",
  "function read(execute){execute('lite',{});execute(unknown,{});}read((name,args)=>client.rpc(name,args));",
  "function read(execute){save(execute);execute('lite',{});}read((name,args)=>client.rpc(name,args));",
  "function read(execute){execute=other;execute('lite',{});}read((name,args)=>client.rpc(name,args));",
  "function read(execute){function nested(execute){execute('wrong',{});}execute('lite',{});}read((name,args)=>client.rpc(name,args));",
  "function read(execute){execute('lite',{});}function caller(read){read((name,args)=>client.rpc(name,args));}",
  "function read(execute){execute('lite',{});}read=unknown;read((name,args)=>client.rpc(name,args));",
  "read((name,args)=>client.rpc(name,args));",
 ];
 for(const source of invalid)assert.equal(resolve(source),undefined,source);
});
test('current RPC inventory resolves all real sinks without discarding dynamic choices',async()=>{
 const source=await serviceInventory();
 for(const row of source.rpc)assert.ok(row.name||row.resolutions.length>0,row.id);
 const pos=source.rpc.find((row:{file:string;dynamic:string})=>row.file.endsWith('PosView.tsx')&&row.dynamic.includes('?'));
 assert.deepEqual(pos.resolutions.map((row:{name:string})=>row.name),['lite1_pos_options2','get_pos_configurable_parcel_options_v1']);
});
