import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startInventory224Local} from './inventory224-local.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {assertReady224Catalog} from '../operations/inventory224-catalog.mjs';
import {assertPrice225Additive,price225CandidatePath} from '../operations/on-prices225-catalog.mjs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';

assert.equal(process.argv.length,2,'PRICES225_CATALOG_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..');
const output=path.join(root,'test-results/on225-candidate-catalog');
await fs.mkdir(output,{recursive:true});
let local;
const report={ok:false,candidateOnly:true,historyCeiling:224,hostedAccess:false,demoAccess:false};
try{
 local=await startInventory224Local(224);
 const before=JSON.parse(await local.sql(schemaCatalogSql));
 assertReady224Catalog(before);
 const sql=canonicalLf(await fs.readFile(path.join(root,price225CandidatePath),'utf8'));
 await local.sql(sql);
 const after=JSON.parse(await local.sql(schemaCatalogSql));
 const changes=assertPrice225Additive(before,after);
 await fs.writeFile(path.join(output,'catalog224.json'),JSON.stringify(before,null,2)+'\n');
 await fs.writeFile(path.join(output,'catalog225-candidate.json'),JSON.stringify(after,null,2)+'\n');
 const pins={format:1,beforeCeiling:224,migrationCeiling:225,migrationSha256:sha256(sql),
  base224PinsSha256:sha256(canonicalLf(await fs.readFile(path.join(root,'docs/design/inventory224/catalog224-pins.json'),'utf8'))),changes};
 await fs.writeFile(path.join(output,'proposed-catalog-pins.json'),JSON.stringify(pins,null,2)+'\n');
 Object.assign(report,{ok:true,existingCatalogUnchanged:true,migrationSha256:pins.migrationSha256,
  addedBySection:Object.fromEntries([...new Set(changes.map(row=>row.section))].map(section=>[section,changes.filter(row=>row.section===section).length]))});
}catch(error){report.error=error.message.split('\n')[0];process.exitCode=1;}
finally{
 await local?.stop();
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
