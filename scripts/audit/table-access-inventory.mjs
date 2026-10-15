// Static source inventory only. Never connects to a database or reads env keys.
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'../..');
const slash=p=>p.replaceAll('\\','/');
const hash=s=>createHash('sha256').update(s).digest('hex');
const sourceExtensions=/\.[cm]?[jt]sx?$/u;
async function files(dir){const result=[];for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
 if(['node_modules','dist','.git'].includes(e.name))continue;const p=path.join(dir,e.name);
 if(e.isDirectory())result.push(...await files(p));else if(sourceExtensions.test(e.name))result.push(p);}return result;}
function scopeOf(node){for(let n=node.parent;n;n=n.parent){if(ts.isFunctionLike(n))return n;}return node.getSourceFile();}
function scopeName(node){const n=scopeOf(node);return n.name?.text||n.parent?.name?.text||'<module>';}
export function parseSource(file,text){
 text=text.replaceAll('\r\n','\n');
 const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const entries=[],excluded=[],subscriptions=[],constants={};
 const method=n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)?n.expression.name.text:null;
 const args=n=>n.arguments.map(a=>a.getText(sf));
 for(const stmt of sf.statements)if(ts.isVariableStatement(stmt))for(const d of stmt.declarationList.declarations){
  if(ts.isIdentifier(d.name)&&d.initializer&&(ts.isStringLiteralLike(d.initializer)||ts.isNumericLiteral(d.initializer)))constants[d.name.text]=d.initializer.text;
 }
 const visit=n=>{
  if(method(n)==='from'){
   const receiver=n.expression.expression.getText(sf),table=n.arguments[0];
   if(receiver==='Array'||receiver.endsWith('Uint8Array'))excluded.push({line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,reason:'JavaScript Array/typed-array, not Supabase'});
   else if(receiver.includes('.storage'))excluded.push({line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,reason:'Storage bucket API, not table/view',expression:n.getText(sf)});
   else{
    if(!table||!ts.isStringLiteralLike(table))throw Error(`UNRESOLVED_TABLE:${file}:${n.getStart(sf)}`);
    let tail=n;const calls=[];
    while(ts.isPropertyAccessExpression(tail.parent)&&ts.isCallExpression(tail.parent.parent)&&tail.parent.parent.expression===tail.parent){tail=tail.parent.parent;calls.push({method:method(tail),args:args(tail)});}
    const operation=calls.find(c=>['select','insert','update','upsert','delete'].includes(c.method))?.method;
    if(!operation)throw Error(`UNRESOLVED_OPERATION:${file}:${n.getStart(sf)}`);
    const extensions=[];
    if(ts.isVariableDeclaration(tail.parent)&&ts.isIdentifier(tail.parent.name)){
     const variable=tail.parent.name.text,scope=scopeOf(n);
     const find=q=>{if(q!==n&&scopeOf(q)===scope&&ts.isCallExpression(q)&&ts.isPropertyAccessExpression(q.expression)&&q.expression.expression.getText(sf)===variable){
       extensions.push({method:method(q),args:args(q),conditional:true,line:sf.getLineAndCharacterOfPosition(q.getStart(sf)).line+1});}
      ts.forEachChild(q,find);};ts.forEachChild(scope,find);
    }
    const line=sf.getLineAndCharacterOfPosition(n.expression.name.getStart(sf)).line+1;
    if(file.startsWith('supabase/functions/')&&!(file==='supabase/functions/send-order-push/index.ts'&&/createClient\(supabaseUrl, serviceRoleKey/u.test(text)&&/serviceRoleKey = Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/u.test(text)))throw Error(`UNRESOLVED_EDGE_ROLE:${file}:${line}`);
    entries.push({id:`${file}:${line}`,file,line,table:table.text,operation,role:file.startsWith('supabase/functions/')?'service_role':file.startsWith('customer-web/')?'anon':'authenticated',
     roleEvidence:file.startsWith('supabase/functions/')?'send-order-push createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY)':file.startsWith('customer-web/')?'customer-web/src/lib/supabase public sessionless client':'src/lib/supabase session client; authenticated ERP user',
     screen:file.startsWith('supabase/')?'Edge send-order-push':file.includes('/pos/')?'POS':path.basename(file).replace('.service.ts',''),
     function:scopeName(n),receiver,calls,extensions,constants,source:tail.getText(sf)});
   }
  }
  if(method(n)==='on'&&n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0])&&n.arguments[0].text==='postgres_changes'){
   const properties=n.arguments[1];if(!properties||!ts.isObjectLiteralExpression(properties))throw Error(`UNRESOLVED_REALTIME:${file}`);
   const values=Object.fromEntries(properties.properties.filter(ts.isPropertyAssignment).map(p=>[p.name.getText(sf),ts.isStringLiteralLike(p.initializer)?p.initializer.text:p.initializer.getText(sf)]));
   if(!values.table)throw Error(`UNRESOLVED_REALTIME_TABLE:${file}`);
   subscriptions.push({file,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,...values,operation:'select',role:'authenticated',function:scopeName(n)});
  }
  ts.forEachChild(n,visit);
 };visit(sf);return {entries,excluded,subscriptions};
}
// Embedded resources also require SELECT: explicitly retain every dependency.
export function embeddedTables(select){const result=[];const regex=/([a-zA-Z_][\w]*(?::[a-zA-Z_][\w]*)?(?:![\w]+)*)\s*\(/gu;
 for(const m of select.matchAll(regex)){const name=m[1].split(':').at(-1).split('!')[0];if(name!=='count')result.push(name);}return [...new Set(result)].sort();}
export async function inventory(){const entries=[],excluded=[],subscriptions=[],sources=[],texts=new Map();
 for(const base of ['src','customer-web/src','supabase/functions'])for(const absolute of await files(path.join(root,base))){
  const file=slash(path.relative(root,absolute)),text=(await readFile(absolute,'utf8')).replaceAll('\r\n','\n'),parsed=parseSource(file,text);sources.push({file,sha256:hash(text)});
  entries.push(...parsed.entries);excluded.push(...parsed.excluded.map(e=>({file,...e})));subscriptions.push(...parsed.subscriptions);texts.set(file,text);
 }
 for(const e of entries){const selection=e.calls.find(c=>c.method==='select')?.args[0];
  const value=e.constants[selection]??(selection&&(/^[`'"]/u.test(selection)?selection.slice(1,-1):''));
  e.embeddedTables=value?embeddedTables(value):[];
  e.callers=[...texts].filter(([f,t])=>f!==e.file&&new RegExp('\\b'+e.function+'\\b','u').test(t)).map(([f])=>f).sort();
  e.screenPaths=e.callers.filter(f=>f.includes('/features/')).map(f=>f.slice(f.indexOf('/features/')+10).split('/')[0]);
  if(e.file.includes('/features/'))e.screenPaths.push(e.file.split('/features/')[1].split('/')[0]);
  if(e.callers.some(f=>f.includes('/stores/')))e.screenPaths.push('shared-store/auth-bootstrap');
  e.screenPaths=[...new Set(e.screenPaths)];e.reachability=e.callers.length||e.file.includes('/features/')||e.role==='service_role'?'has-source-consumer':'no-static-consumer-found';
 }
 const {migrationCeiling}=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));
 return {schemaVersion:1,migrationCeiling,managedAccess:false,sources,entries,subscriptions,excluded,
  totals:{queries:entries.length,tableNames:[...new Set(entries.flatMap(e=>[e.table,...e.embeddedTables]))].sort(),
   authenticated:entries.filter(e=>e.role==='authenticated').length,service_role:entries.filter(e=>e.role==='service_role').length,
   anon:entries.filter(e=>e.role==='anon').length,subscriptions:subscriptions.length}};
}
export async function writeInventory(value){await writeFile(path.join(root,'docs/operations/TABLE_ACCESS_INVENTORY.json'),JSON.stringify(value,null,2)+'\n');}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const value=await inventory();await writeInventory(value);
 let evidence;try{evidence=JSON.parse(await readFile(path.join(root,'docs/operations/TABLE_ACCESS_DIAGNOSTIC.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const {reportWithSupplement}=await import('./table-access-report.mjs');
 const fresh=evidence&&JSON.stringify(evidence.sourceHashes)===JSON.stringify(value.sources);
 const markdown=fresh?await reportWithSupplement(value,evidence):'# جرد الوصول المباشر للجداول\n\n**--apply موقوف. أدلة runtime غير موجودة أو قديمة؛شغّل التشخيص الحقيقي ثم مولّد التقرير.**\n\n| المصدر | الجدول | العملية | الدور |\n|---|---|---|---|\n'+value.entries.map(e=>`| ${e.id} | ${e.table} | ${e.operation} | ${e.role} |`).join('\n')+'\n';
 await writeFile(path.join(root,'docs/operations/TABLE_ACCESS_INVENTORY.md'),markdown);console.log(JSON.stringify(value.totals));}
