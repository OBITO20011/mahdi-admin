import assert from 'node:assert/strict';
export const batch219Name='home219_shared_period_facts_internal';
export const adjust219Name='home219_adjust208_internal';
export const adjust215Name='home219_adjust215_internal';
export function maskSql(sql){
 let out='',i=0;while(i<sql.length){
  if(sql.startsWith('--',i)){let j=sql.indexOf('\n',i);if(j<0)j=sql.length;out+=' '.repeat(j-i);i=j;continue;}
  if(sql.startsWith('/*',i)){let j=i+2,n=1;while(j<sql.length&&n){if(sql.startsWith('/*',j)){n++;j+=2;}else if(sql.startsWith('*/',j)){n--;j+=2;}else j++;}assert.equal(n,0);out+=' '.repeat(j-i);i=j;continue;}
  if(sql[i]==="'"||sql[i]==='"'){const q=sql[i];let j=i+1,done=false;while(j<sql.length){if(sql[j]==='\\'&&q==="'"){j+=2;continue;}if(sql[j]===q){if(sql[j+1]===q){j+=2;continue;}j++;done=true;break;}j++;}assert.ok(done);out+=' '.repeat(j-i);i=j;continue;}
  out+=sql[i++];
 }return out;
}
export function replaceSqlWords(sql,mapping){const mask=maskSql(sql),replacements=[];for(const m of mask.matchAll(/\b[A-Za-z_][A-Za-z_0-9]*\b/gu)){const value=mapping[m[0]];if(value!==undefined)replacements.push({start:m.index,end:m.index+m[0].length,value});}let out=sql;for(const r of replacements.reverse())out=out.slice(0,r.start)+r.value+out.slice(r.end);return out;}
export function splitCtes(query){
 const mask=maskSql(query),start=mask.search(/\bWITH\b/u);assert.ok(start>=0);let i=start+4;const ctes=[];
 while(i<query.length){while(/\s/u.test(mask[i]??''))i++;const m=mask.slice(i).match(/^([a-z_][a-z_0-9]*)\s+AS\s+(?:MATERIALIZED\s+)?\(/u);assert.ok(m,'HOME219_CTE_HEADER_EXPECTED');const open=i+m[0].length-1;let j=open+1,n=1;while(j<mask.length&&n){if(mask[j]==='(')n++;else if(mask[j]===')')n--;j++;}assert.equal(n,0,'HOME219_UNBALANCED_CTE');ctes.push({name:m[1],raw:query.slice(i,j),body:query.slice(open+1,j-1)});i=j;while(/\s/u.test(mask[i]??''))i++;if(mask[i]!==',')break;i++;}
 const select=query.slice(i);assert.match(maskSql(select),/^SELECT\b/u);return{ctes,select};
}
export function buildShared219Definition(baseDefinition,{adjust208=false,postprocessName=adjust219Name}={}){
 const a=baseDefinition.indexOf('  WITH first_completion AS MATERIALIZED ('),b=baseDefinition.indexOf('\n  RETURN v_facts;',a);assert.ok(a>=0&&b>a,'HOME219_EXACT_BASE_QUERY_REQUIRED');let query=baseDefinition.slice(a,b).trim();
 assert.equal(query.split(' INTO v_facts').length,2);query=query.replace(' INTO v_facts','');
 const {ctes,select}=splitCtes(query),scopedNames=new Set(),shared=[],scoped=[];
 for(const c of ctes){const tokens=new Set(maskSql(c.body).match(/\b[A-Za-z_][A-Za-z_0-9]*\b/gu)||[]);const isScoped=['p_period_start','p_period_end','v_damage',...scopedNames].some(n=>tokens.has(n));if(isScoped){scopedNames.add(c.name);scoped.push(c);}else shared.push(c);}
 assert.ok(shared.some(c=>c.name==='order_scope'));assert.ok(shared.some(c=>c.name==='money_events'));assert.ok(shared.some(c=>c.name==='balances'));
 const sales=scoped.find(c=>c.name==='period_sales');assert.ok(sales);assert.match(maskSql(sales.body),/SELECT\s+\*\s+FROM\s+order_scope\b/u);
 let union=sales.raw.replace(/^period_sales\s+AS\s*\(/u,'unified_sales219 AS MATERIALIZED (').replace(/SELECT\s+\*/u,'SELECT id,total_in_minor_units,delivery_fee_in_minor_units,completion_at,status');
 union=replaceSqlWords(union,{p_period_start:'LEAST(p_month_start,p_week_start)',p_period_end:'GREATEST(p_month_end,p_week_end)'});
 const usesDamage=/\bv_damage\b/u.test(maskSql(query));
 const map={p_period_start:'scope219.period_start',p_period_end:'scope219.period_end',...(usesDamage?{v_damage:'(SELECT value FROM scope_damage219)'}:{})};
 const inside=scoped.map(c=>replaceSqlWords(c.name==='period_sales'?c.raw.replace(/FROM\s+order_scope\b/u,'FROM unified_sales219'):c.raw,map));
 if(usesDamage)inside.unshift('scope_damage219 AS MATERIALIZED (SELECT public.inventory_damage_period_totals_internal(p_branch_id,scope219.period_start,scope219.period_end) AS value)');
 const finalSelect=replaceSqlWords(select,map).replace(/;\s*$/u,'');
 const result=adjust208?`public.${postprocessName}(period219.facts,p_branch_id,scope219.period_start,scope219.period_end,p_timezone,false)`:'period219.facts';
 const sql=`CREATE OR REPLACE FUNCTION public.${batch219Name}(p_branch_id UUID,p_month_start TIMESTAMPTZ,p_month_end TIMESTAMPTZ,p_week_start TIMESTAMPTZ,p_week_end TIMESTAMPTZ,p_timezone TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $home219$
DECLARE result JSONB;
BEGIN
 IF p_month_start IS NULL OR p_month_end IS NULL OR p_week_start IS NULL OR p_week_end IS NULL OR p_month_end<=p_month_start OR p_week_end<=p_week_start OR NULLIF(BTRIM(p_timezone),'') IS NULL THEN RAISE EXCEPTION 'Invalid Phase 6 financial facts period.'; END IF;
 WITH ${shared.map(c=>c.raw).join(',\n')},
 ${union}
 SELECT jsonb_object_agg(scope219.key,${result}) INTO result
 FROM (VALUES('month'::TEXT,p_month_start,p_month_end),('week'::TEXT,p_week_start,p_week_end))scope219(key,period_start,period_end)
 CROSS JOIN LATERAL (
 WITH ${inside.join(',\n')}
 ${finalSelect}
 )period219(facts);
 RETURN result;
END $home219$;
ALTER FUNCTION public.${batch219Name}(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.${batch219Name}(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) FROM PUBLIC,anon,authenticated,service_role;
`;
 return{sql,sharedNames:shared.map(c=>c.name),scopedNames:scoped.map(c=>c.name),baseQuery:query,sharedCtes:shared,scopedCtes:scoped};
}
export function adjust208Definition(original){
 const name='CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal(';assert.equal(original.split(name).length,2);
 let result=original.replace(name,`CREATE OR REPLACE FUNCTION public.${adjust219Name}(p_base JSONB,`);
 const call='facts:=public.phase6_financial_facts_before208_internal(p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);';assert.equal(result.split(call).length,2);result=result.replace(call,'facts:=p_base;');
 return result+`\nALTER FUNCTION public.${adjust219Name}(JSONB,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) OWNER TO postgres;\nREVOKE ALL ON FUNCTION public.${adjust219Name}(JSONB,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;\n`;
}
export function sharedHome219Definition(original){
 assert.ok(!original.includes('v_shared219'),'HOME219_ALREADY_SHARED');
 const month=/v_month\s*:=\s*public\.phase6_financial_facts_internal\(\s*NULL,\s*v_month_start,\s*v_tomorrow_start,\s*'Asia\/Amman',\s*false\);/gu;
 const week=/v_week\s*:=\s*public\.phase6_financial_facts_internal\(\s*NULL,\s*v_today_start\s*-\s*INTERVAL\s*'6 days',\s*v_tomorrow_start,\s*'Asia\/Amman',\s*false\);/gu;
 assert.equal([...original.matchAll(month)].length,1,'HOME219_ORIGINAL_MONTH_READ_REQUIRED');assert.equal([...original.matchAll(week)].length,1,'HOME219_ORIGINAL_WEEK_READ_REQUIRED');
 let result=original.replace(/\bDECLARE\b/u,'DECLARE\n  v_shared219 JSONB;');
 result=result.replace(month,matched=>`IF v_today_start - INTERVAL '6 days' >= v_month_start THEN\n      ${matched}\n    ELSE\n      v_shared219:=public.${batch219Name}(NULL,v_month_start,v_tomorrow_start,v_today_start - INTERVAL '6 days',v_tomorrow_start,'Asia/Amman');\n      v_month:=v_shared219->'month';\n    END IF;`);
 result=result.replace(week,"v_week:=v_shared219->'week';");return result;
}
export function adjust215Definition(original){
 const name='CREATE FUNCTION public.phase6_financial_facts_internal(';assert.equal(original.split(name).length,2);
 let result=original.replace(name,`CREATE OR REPLACE FUNCTION public.${adjust215Name}(p_base JSONB,`);
 const call='facts:=public.tb215_financial_facts_before215_internal(p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);';assert.equal(result.split(call).length,2);result=result.replace(call,`facts:=public.${adjust219Name}(p_base,p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);`);
 return result+`\nALTER FUNCTION public.${adjust215Name}(JSONB,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) OWNER TO postgres;\nREVOKE ALL ON FUNCTION public.${adjust215Name}(JSONB,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;\n`;
}
