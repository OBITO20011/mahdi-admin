import {sourceBeforeEnvironments} from './source-before-environments.mjs';
// Historical DB evidence stays immutable. Admit ONLY the owner's two literal
// public-config substitutions; pin the complete restored files, not exclusions.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {inventoryBeforeSales204 as inventory} from './source-before-sales-history204.mjs';
import {restoreUnitSourceHashes} from './source-before-unit-terminology.mjs';
import {projectHistoricalWarehouseQuerySites} from './historical-warehouse-query-sites.mjs';
const pins={
 'src/config/supabase-public-config.ts':'35f06dc43da3677958e91878303b7787d4352f68e0d7eec66c49df70e295826f',
 'customer-web/src/config/supabase-public-config.ts':'47bb4a4f235b8d83d1742ce44141fad42ab30910ae4cd1fc1868fa114529807b',
};
const hash=s=>createHash('sha256').update(s).digest('hex');
export function restoreStagingConfig(file,text){
 assert.ok(Object.hasOwn(pins,file),'NOT_AN_APPROVED_CONFIG');
 let restored=sourceBeforeEnvironments(file,text);
 for(const [after,before]of[
  ["SUPABASE_URL: 'https://kzevmysfydaslxcerogt.supabase.co'","SUPABASE_URL: 'https://acjtabdqqnpwhdvbvnyw.supabase.co'"],
  ["SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_d4TElxRQFkC-AZko3_ASeg_YotqxGjV'","SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_XYq8HBYT6Pxa2VdRdi69CA_012vvfp5'"],
 ]){assert.equal(restored.split(after).length,2,'EXACT_OWNER_PUBLIC_CONFIG_REQUIRED');restored=restored.replace(after,before);}
 assert.equal(hash(restored),pins[file],'CONFIG_CHANGED_BEYOND_TWO_OWNER_LITERALS');return restored;
}
export async function sourceBeforeStagingConfig(sources){
 const result=restoreUnitSourceHashes(sources).map(s=>({...s}));
 for(const file of Object.keys(pins)){
  const current=sourceBeforeEnvironments(file,await readFile(file,'utf8')),entry=result.find(s=>s.file===file);
  assert.ok(entry,'CONFIG_SOURCE_REQUIRED');assert.equal(entry.sha256,hash(current),'CURRENT_CONFIG_HASH_MISMATCH');
  entry.sha256=hash(restoreStagingConfig(file,current));
 }
 return result;
}
export async function inventoryBeforeStagingConfig(){const source=await inventory();return {...projectHistoricalWarehouseQuerySites(source),sources:await sourceBeforeStagingConfig(source.sources)};}
