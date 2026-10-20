// Preserve historical access proofs without rewriting their captured hashes.
// Admit198's exactly reversible display guard and the separately pinned two
// public-config literals. Historical query sites/every other hash stay exact.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inventoryBeforeSales204 as inventory} from './source-before-sales-history204.mjs';
import {sourceBeforeStagingConfig} from './source-before-staging-config.mjs';
import {projectHistoricalWarehouseQuerySites} from './historical-warehouse-query-sites.mjs';
const file='src/features/crm/CustomerCollectionModal.tsx';
const declaration="  const isCashier = useAppStoreSelector(state => state.currentUser.role === 'Cashier');\n";
export function restore198CollectionPresentation(source){
 const current=source.replaceAll('\r\n','\n');
 assert.equal(current.split(declaration).length,2,'198_EXACT_DISPLAY_DECLARATION');
 assert.equal(current.split(': !isCashier && <UiButton').length,2,'198_EXACT_DISPLAY_GUARD');
 return current.replace(declaration,'').replace(': !isCashier && <UiButton',': <UiButton');
}
export async function sourceBefore198Presentation(sources){
 const current=(await readFile(file,'utf8')).replaceAll('\r\n','\n'),old=restore198CollectionPresentation(current);
 const hash=s=>createHash('sha256').update(s).digest('hex');
 assert.equal(hash(old),'a9ad147f82c4c6160ca5f8a20b616351ef06f4e26ffd839d50d26f4c414a4f0b','HISTORICAL_COLLECTION_SOURCE_CHANGED');
 assert.equal(sources.find(s=>s.file===file)?.sha256,hash(current),'CURRENT_COLLECTION_HASH_MISMATCH');
 return (await sourceBeforeStagingConfig(sources)).map(s=>s.file===file?{...s,sha256:hash(old)}:s);
}
export async function inventoryBefore198Presentation(){
 const source=await inventory();return {...projectHistoricalWarehouseQuerySites(source),sources:await sourceBefore198Presentation(source.sources)};
}
