// Companion audit: source-only RPC/Storage/Realtime/config inventory. No credentials.
import ts from 'typescript';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {inventory} from './table-access-inventory.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const method=n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)?n.expression.name.text:null;
const literal=n=>n&&ts.isStringLiteralLike(n)?n.text:null;
function enclosing(node){for(let n=node.parent;n;n=n.parent)if(ts.isFunctionLike(n))return n.name?.getText()||n.parent?.name?.getText()||'<callback>';return '<module>';}
export function parseServices(file,text){
 const source=text.replaceAll('\r\n','\n'),sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const rpc=[],storage=[],channels=[],env=[],wrapperCalls=[],bindings=[];
 const role=file.startsWith('customer-web/')?'anon':file.startsWith('supabase/functions/')?
  /\/(?:send-order-push|n8n-alert-feed|submit-guest-order|owner-telegram-dispatch)\//u.test(file)?'service_role':'authenticated':'authenticated';
 const visit=n=>{
  if(ts.isVariableDeclaration(n)&&n.initializer&&ts.isIdentifier(n.name)){
   const strings=[];const find=s=>{if(ts.isStringLiteralLike(s))strings.push(s.text);ts.forEachChild(s,find);};find(n.initializer);
   bindings.push({name:n.name.text,strings,source:n.initializer.getText(sf)});
  }
  if(ts.isCallExpression(n)){
   const name=method(n),line=sf.getLineAndCharacterOfPosition(n.getStart()).line+1;
   if(name==='rpc')rpc.push({id:file+':'+line,file,line,role,receiver:n.expression.expression.getText(sf),function:enclosing(n),
    name:literal(n.arguments[0]),dynamic:n.arguments[0]?.getText(sf),arguments:n.arguments.slice(1).map(a=>a.getText(sf)),source:n.getText(sf)});
   if(name==='from'&&n.expression.expression.getText(sf).includes('.storage')){
    let tail=n;while(ts.isPropertyAccessExpression(tail.parent)&&ts.isCallExpression(tail.parent.parent))tail=tail.parent.parent;
    storage.push({file,line,role,operation:method(tail),bucket:literal(n.arguments[0])||n.arguments[0]?.getText(sf),source:tail.getText(sf)});
   }
   if(name==='channel')channels.push({file,line,role,source:n.getText(sf)});
   if((name==='get'&&n.expression.expression.getText(sf)==='Deno.env')||(ts.isIdentifier(n.expression)&&n.expression.text==='getEnv')){
    const key=literal(n.arguments[0]);if(key)env.push({file,line,name:key});
   }
   if(ts.isIdentifier(n.expression)&&['rpc','callRpc','executeRpc'].includes(n.expression.text)){
    const offset=n.expression.text==='callRpc'?2:0;
    wrapperCalls.push({file,line,role,wrapper:n.expression.text,name:literal(n.arguments[offset]),dynamic:n.arguments[offset]?.getText(sf),source:n.getText(sf)});
   }
  }
  ts.forEachChild(n,visit);
 };visit(sf);
 for(const call of wrapperCalls.filter(c=>!c.name))call.resolutions=bindings.filter(b=>b.name===call.dynamic).flatMap(b=>b.strings.filter(s=>/^\w+$/u.test(s)).map(name=>({name,source:b.source})));
 return {rpc,storage,channels,env,wrapperCalls};
}
export async function serviceInventory({projectSource=(_file,text)=>text}={}){const base=await inventory({projectSource}),result={schemaVersion:1,migrationCeiling:base.migrationCeiling,managedAccess:false,sourceHashes:base.sources,rpc:[],storage:[],channels:[],env:[],wrapperCalls:[]};
 for(const entry of base.sources){const parsed=parseServices(entry.file,projectSource(entry.file,(await readFile(path.join(root,entry.file),'utf8')).replaceAll('\r\n','\n')));
  for(const key of ['rpc','storage','channels','env','wrapperCalls'])result[key].push(...parsed[key]);}
 // Resolve dynamic sinks by their actual wrapper invocations;fail unknown sinks.
 for(const r of result.rpc.filter(r=>!r.name)){
  let calls=[];
  if(r.file.endsWith('/parcelConfiguration.service.ts'))calls=result.wrapperCalls.filter(c=>c.file===r.file&&c.wrapper==='rpc'&&c.name);
  else if(r.file.endsWith('/posV2.service.ts')||r.file.endsWith('/posV2Recovery.ts'))calls=result.wrapperCalls.filter(c=>c.wrapper==='executeRpc'&&c.name);
  else if(r.file==='supabase/functions/owner-telegram-dispatch/handler.ts')calls=result.wrapperCalls.filter(c=>c.file===r.file&&c.wrapper==='rpc'&&c.name);
  if(!calls.length)throw Error('UNRESOLVED_RPC_SINK:'+r.id);
  r.resolutions=calls.map(c=>({name:c.name,callsite:c.file+':'+c.line,source:c.source}));
 }
 // submit-guest-order deliberately calls REST directly with the service key.
 const gatewayRpc=result.wrapperCalls.filter(c=>c.wrapper==='callRpc');
 for(const call of gatewayRpc)if(!call.name&&!call.resolutions?.length)throw Error('UNRESOLVED_GATEWAY_RPC:'+call.file+':'+call.line);
 const functionNames=[...new Set([...result.rpc.flatMap(r=>r.name?[r.name]:r.resolutions.map(c=>c.name)),...gatewayRpc.flatMap(c=>c.name?[c.name]:c.resolutions.map(r=>r.name))])].sort();
 return {...result,gatewayRpc,functionNames};
}
export async function saveServices(value){await writeFile(path.join(root,'docs/operations/SERVICE_ACCESS_INVENTORY.json'),JSON.stringify(value,null,2)+'\n');}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const v=await serviceInventory();await saveServices(v);console.log(JSON.stringify({rpcSites:v.rpc.length,gatewaySites:v.gatewayRpc.length,functionNames:v.functionNames.length,storage:v.storage.length,channels:v.channels.length,dynamic:v.rpc.filter(r=>!r.name)}));}
