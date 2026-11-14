// Independent fresh versus incremental literal222. Evidence only; never edits
// tracked pins/docs while a verification process is running.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {startPrices222Local} from './independent-prices222-local.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {canonicalLf,sha256,manifestDigest} from './maintenance-db-contract.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
import {assertReady220Catalog} from '../operations/frankfurt-reference220.mjs';
import {assertPrice222Additive,price222FunctionSnapshot,independentPrices222Name} from '../operations/independent-prices222-catalog.mjs';
const root=path.resolve(import.meta.dirname,'../..'),output=path.join(root,'test-results/independent-prices222-catalog');
assert.equal(process.argv.length,2,'NO_CONNECTION_OR_TARGET_ARGUMENTS');await mkdir(output,{recursive:true});
const report={ok:false,hostedAccess:false,ownerDemoAccess:false,networkAttachments:0,cleanup:false};let local;
const save=(name,value)=>writeFile(path.join(output,name+'.json'),JSON.stringify(value,null,2)+'\n');
try{
 const frozen=await readVerificationSourceFreeze(root);
 local=await startPrices222Local(220);
 const capture=async()=>({catalog:JSON.parse(await local.sql(schemaCatalogSql)),buildUtcDate:await local.sql("SELECT(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")});
 const before=await capture();assertReady220Catalog(before.catalog);await save('catalog220',before);
 const migration=canonicalLf(await readFile(path.join(root,'supabase/migrations',independentPrices222Name),'utf8'));
 report.migrationSha256=sha256(migration);await local.sql(migration);
 await local.sql("INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('222','independent_lite_parcel_prices');");
 const after=await capture();assertPrice222Additive(before.catalog,after.catalog);await save('catalog222-incremental',after);
 await local.stop();local=null;
 local=await startPrices222Local(222);const fresh=await capture();
 const differences=catalogDifference(after.catalog,fresh.catalog,{beforeBuildDate:after.buildUtcDate,afterBuildDate:fresh.buildUtcDate});
 await save('fresh-incremental-differences',differences);assert.deepEqual(differences,[],'PRICES222_FRESH_INCREMENTAL_DIFFERENCES');
 const generator=await readFile(path.join(root,'scripts/testing/generate-db-functions.mjs'),'utf8');
 const query=generator.match(/const query = `(BEGIN READ ONLY;[\s\S]+?ROLLBACK;)`;/u)?.[1];assert.ok(query&&!query.includes('${'));
 const functions=JSON.parse(await local.sql(query));assert.equal(functions.length,683);
 await save('public222-functions',functions);await save('catalog222-fresh',fresh);
 await save('new-function-pins',price222FunctionSnapshot(fresh.catalog));
 report.manifestSha256=manifestDigest(local.manifest);
 assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));
 Object.assign(report,{ok:true,publicFunctions:683,privateFunctions:fresh.catalog.functions.filter(f=>['sales_lite1','sales_lite2'].includes(f.schema)).length,existingCatalogUnchanged:true,freshIncrementalDifferences:0});
}catch(error){report.error=String(error.stack).slice(0,5000);process.exitCode=1;}
finally{if(local)await local.stop();report.cleanup=true;await save('report',report);console.log(JSON.stringify(report));}
