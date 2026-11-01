// Deterministic read-only219 SQL from immutable, hash-checked contracts.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';
import {originalHomeFactsDefinition,narrowHome219Definition} from './home-projection219.mjs';
import {buildShared219Definition,adjust208Definition,adjust215Definition,adjust215Name,sharedHome219Definition,batch219Name} from './home-shared-scopes219.mjs';

export const home219MigrationName='219_home_financial_facts_narrow_projection.sql';
export function extractSqlFunction(source,name){
 const header=new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\(','u'),match=header.exec(source);assert.ok(match,'HOME219_SOURCE_FUNCTION_REQUIRED:'+name);
 const offset=match.index,tail=source.slice(offset),body=tail.match(/\bAS\s+(\$[a-z_]*\$)/iu);assert.ok(body,'HOME219_SOURCE_DELIMITER_REQUIRED');
 const end=source.indexOf(body[1]+';',offset+body.index+body[0].length);assert.ok(end>=0,'HOME219_SOURCE_END_REQUIRED');return source.slice(offset,end+body[1].length+1);
}
async function historical(root,version){
 const names=await readdir(path.join(root,'supabase/migrations')),name=names.find(n=>n.startsWith(version+'_')&&n.endsWith('.sql'));assert.ok(name);
 const source=canonicalLf(await readFile(path.join(root,'supabase/migrations',name),'utf8')),state=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));
 assert.equal(sha256(source).toUpperCase(),state[`migration${version}CanonicalLfSha256`],'HOME219_IMMUTABLE_SOURCE_DRIFT:'+name);return source;
}
export async function buildHome219Migration(root){
 const base=narrowHome219Definition(await originalHomeFactsDefinition(root,203,{privateName:true}));
 const wrap208=extractSqlFunction(await historical(root,208),'phase6_financial_facts_internal'),wrap215=extractSqlFunction(await historical(root,215),'phase6_financial_facts_internal');
 const core=extractSqlFunction(await historical(root,202),'_get_home_dashboard_before133');
 const shared=buildShared219Definition(base,{adjust208:true,postprocessName:adjust215Name});
 return '-- Owner-approved219: shared month/week read; unchanged equations, periods and application grants.\n-- 218 remains reserved. New helpers are private; all historical writers and readers remain.\nBEGIN;\n\n'+base+'\n\n'+adjust208Definition(wrap208)+'\n'+adjust215Definition(wrap215)+'\n'+shared.sql+'\n'+sharedHome219Definition(core)+'\n\nCOMMIT;\n';
}
export function historicalShared219Compatibility(originalFacts,originalHome){
 const narrowed=narrowHome219Definition(originalFacts),shared=buildShared219Definition(narrowed);
 return{sql:narrowed+'\n'+shared.sql+'\n'+sharedHome219Definition(originalHome),
  restoreSql:originalFacts+';\n'+originalHome+';\n'+`DROP FUNCTION public.${batch219Name}(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,TEXT);`,
  sharedNames:shared.sharedNames,scopedNames:shared.scopedNames};
}
const root=path.resolve(import.meta.dirname,'../..');
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const sql=await buildHome219Migration(root),file=path.join(root,'supabase/migrations',home219MigrationName);
 if(process.argv.includes('--write'))await writeFile(file,sql);
 else assert.equal(canonicalLf(await readFile(file,'utf8')),sql,'HOME219_GENERATED_SQL_DRIFT');
 console.log(JSON.stringify({migration:home219MigrationName,sha256:sha256(sql),functions:5,historicalSources:[202,203,208,215],mode:process.argv.includes('--write')?'write':'check'}));
}
