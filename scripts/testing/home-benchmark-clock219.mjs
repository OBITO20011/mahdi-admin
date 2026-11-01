// Disposable SQL benchmark clock. PostgreSQL's physical/monotonic clock and
// EXPLAIN instrumentation remain untouched. No production import or migration.
import assert from 'node:assert/strict';
export const home219HardDate='2026-11-01';
export const home219HardInstant=home219HardDate+'T12:00:00Z';
export const benchmark219Projects=Object.freeze(['nawasrah-canonical197-scale-test','nawasrah-home-damage201-scale-test','nawasrah-home-damage202-scale-test','nawasrah-home-damage203-scale-test','nawasrah-home219-scale-test','nawasrah-home219-round2-test']);
const ident=s=>'"'+s.replaceAll('"','""')+'"';
export function shiftSqlBenchmarkClock(input,offsetSeconds){
 assert.ok(Number.isSafeInteger(offsetSeconds)&&Math.abs(offsetSeconds)<=10*366*86400,'BENCH219_CLOCK_OFFSET_INVALID');
 assert.ok(!input.includes('/* bench219-clock */'),'BENCH219_CLOCK_DOUBLE_REWRITE');
 let changes=0;
 const shifted=expression=>{changes++;return`(/* bench219-clock */ ${expression} + INTERVAL '${offsetSeconds} seconds')`;};
 const parse=(s,level=0)=>{
  assert.ok(level<=8,'BENCH219_CLOCK_NESTING_UNSUPPORTED');let out='',i=0,lastWord='';
  while(i<s.length){
   if(s.startsWith('--',i)){let end=s.indexOf('\n',i);if(end<0)end=s.length;out+=s.slice(i,end);i=end;continue;}
   if(s.startsWith('/*',i)){let j=i+2,depth=1;while(j<s.length&&depth){if(s.startsWith('/*',j)){depth++;j+=2;}else if(s.startsWith('*/',j)){depth--;j+=2;}else j++;}assert.equal(depth,0,'BENCH219_CLOCK_UNTERMINATED_COMMENT');out+=s.slice(i,j);i=j;continue;}
   if(s[i]==="'"||s[i]==='"'){
    const quote=s[i];let j=i+1,closed=false;
    while(j<s.length){if(s[j]==='\\'&&quote==="'"){j+=2;continue;}if(s[j]===quote){if(s[j+1]===quote){j+=2;continue;}j++;closed=true;break;}j++;}
    assert.ok(closed,'BENCH219_CLOCK_UNTERMINATED_QUOTE');out+=s.slice(i,j);i=j;continue;
   }
   const dollar=s[i]==='$'?s.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/u)?.[0]:null;
   if(dollar){const end=s.indexOf(dollar,i+dollar.length);assert.ok(end>=0,'BENCH219_CLOCK_UNTERMINATED_BODY');const body=s.slice(i+dollar.length,end);out+=dollar+(['AS','DO'].includes(lastWord)?parse(body,level+1):body)+dollar;i=end+dollar.length;lastWord='';continue;}
   if(/[A-Za-z_]/u.test(s[i])&&(i===0||!/[\w.]/u.test(s[i-1]))){
    const call=s.slice(i).match(/^(?:pg_catalog\s*\.\s*)?(now|clock_timestamp|statement_timestamp|transaction_timestamp)\s*\(\s*\)/iu);
    if(call){out+=shifted('pg_catalog.'+call[1].toLowerCase()+'()');i+=call[0].length;lastWord='';continue;}
    const current=s.slice(i).match(/^CURRENT_(TIMESTAMP|DATE)\b(?:\s*\(\s*([0-6])\s*\))?/iu);
    if(current){let expression='pg_catalog.transaction_timestamp()';if(current[2]!==undefined)expression+='::timestamp('+current[2]+') with time zone';let result=shifted(expression);if(current[1].toUpperCase()==='DATE')result+='::date';out+=result;i+=current[0].length;lastWord='';continue;}
    const word=s.slice(i).match(/^[A-Za-z_]\w*/u)[0];out+=word;i+=word.length;lastWord=word.toUpperCase();continue;
   }
   if(s[i]===';')lastWord='';out+=s[i++];
  }
  return out;
 };
 return{sql:parse(input),changes};
}
export async function installBenchmark219Clock({rawSql,project}){
 assert.ok(benchmark219Projects.includes(project),'BENCH219_CLOCK_LOCAL_PROJECT_REQUIRED');
 const read=async s=>JSON.parse(await rawSql(s));
 const real=await read("SELECT jsonb_build_object('epoch',EXTRACT(EPOCH FROM clock_timestamp())::bigint,'day',(clock_timestamp() AT TIME ZONE 'Asia/Amman')::date);");
 const outside=await read("SELECT jsonb_build_object('policies',(SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (COALESCE(pg_get_expr(polqual,polrelid),'')||COALESCE(pg_get_expr(polwithcheck,polrelid),''))~*'(now\\(|clock_timestamp|current_date|current_timestamp)'),'views',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' AND pg_get_viewdef(c.oid)~*'(now\\(|clock_timestamp|current_date|current_timestamp)'),'checks',(SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='c' AND pg_get_constraintdef(c.oid)~*'(now\\(|clock_timestamp|current_date|current_timestamp)'));" );
 assert.deepEqual(outside,{policies:0,views:0,checks:0},'BENCH219_CLOCK_UNSUPPORTED_SCHEMA_CLOCK');
 const offsetSeconds=Math.floor(Date.parse(home219HardInstant)/1000)-Number(real.epoch);
 const functions=await read("SELECT COALESCE(jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',p.proowner::regrole::text,'acl',p.proacl::text,'config',p.proconfig) ORDER BY p.oid::regprocedure::text),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN('f','p');");
 const defaults=await read("SELECT COALESCE(jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'expression',pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attname),'[]') FROM pg_attrdef d JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.adnum WHERE n.nspname='public';");
 const changedFunctions=functions.map(f=>({...f,rewrite:shiftSqlBenchmarkClock(f.definition,offsetSeconds)})).filter(f=>f.rewrite.changes);
 const changedDefaults=defaults.map(d=>({...d,rewrite:shiftSqlBenchmarkClock(d.expression,offsetSeconds)})).filter(d=>d.rewrite.changes);
 assert.ok(changedFunctions.length>0&&changedDefaults.length>0,'BENCH219_CLOCK_NOT_APPLIED');
 const columnDefault=(d,value)=>'ALTER TABLE public.'+ident(d.table)+' ALTER COLUMN '+ident(d.column)+' SET DEFAULT '+value+';';
 await rawSql('BEGIN;'+changedFunctions.map(f=>f.rewrite.sql+';').join('\n')+changedDefaults.map(d=>columnDefault(d,d.rewrite.sql)).join('\n')+'COMMIT;');
 let restored=false;
 const sql=async(text,variables)=>rawSql(shiftSqlBenchmarkClock(text,offsetSeconds).sql,variables);
 const assertHardCase=async()=>{
  const value=JSON.parse(await sql("SELECT jsonb_build_object('day',(NOW() AT TIME ZONE 'Asia/Amman')::date,'crossMonthWeek',date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman')-interval '6 days'<date_trunc('month',NOW() AT TIME ZONE 'Asia/Amman'));") );
  assert.equal(value.day,home219HardDate,'BENCH219_HARD_DATE_CHANGED');assert.equal(value.crossMonthWeek,true,'BENCH219_HARD_WEEK_MUST_CROSS_MONTH');return value;
 };
 const fingerprint=()=>read("SELECT jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',p.proowner::regrole::text,'acl',p.proacl::text,'config',p.proconfig) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN('f','p');");
 const restore=async()=>{if(restored)return;await rawSql('BEGIN;'+changedFunctions.map(f=>f.definition+';').join('\n')+changedDefaults.map(d=>columnDefault(d,d.expression)).join('\n')+'COMMIT;');assert.deepEqual(await fingerprint(),functions,'BENCH219_CLOCK_FUNCTIONS_ACL_CONFIG_MUST_RESTORE');
  const after=await read("SELECT COALESCE(jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'expression',pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attname),'[]') FROM pg_attrdef d JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.adnum WHERE n.nspname='public';");assert.deepEqual(after,defaults,'BENCH219_CLOCK_DEFAULTS_MUST_RESTORE');restored=true;
 };
 try{await assertHardCase();}catch(e){await restore();throw e;}
 const originalDefinition=identity=>{const value=functions.find(f=>f.identity.replace(/^public\./u,'')===identity.replace(/^public\./u,''));assert.ok(value,'BENCH219_ORIGINAL_FUNCTION_REQUIRED');return value.definition+';';};
 return{sql,restore,assertHardCase,originalDefinition,report:{hardDate:home219HardDate,anchor:home219HardInstant,offsetSeconds,changedFunctions:changedFunctions.length,changedDefaults:changedDefaults.length,physicalServerClockChanged:false,instrumentationClockChanged:false}};
}
