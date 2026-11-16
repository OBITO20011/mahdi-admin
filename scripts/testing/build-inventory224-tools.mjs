// Exact reviewed 223 templates; only the versioned 224 adapter is emitted.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';
const root=new URL('../../',import.meta.url);
const pins=JSON.parse(await readFile(new URL('docs/design/inventory224/tool223-source-pins.json',root),'utf8'));
const check=process.argv[2]==='--check';
assert.ok(process.argv.length===2||process.argv.length===3&&check,'ONLY_CHECK_OPTION');
function once(text,from,to){assert.equal(text.split(from).length,2,'EXACT224_TOOL_HUNK:'+from.slice(0,100));return text.replace(from,()=>to);}
const output=new Map();
for(const[file,digest]of Object.entries(pins)){
 let text=canonicalLf(await readFile(new URL('scripts/operations/'+file,root),'utf8'));
 assert.equal(sha256(text),digest,'EXACT224_TOOL_SOURCE:'+file);
 // SHA commitments are bytes, not version labels.
 const hashes=[];text=text.replace(/\b[a-f0-9]{64}\b/gu,value=>{hashes.push(value);return 'REVIEWED_HASH_'+(hashes.length-1)+'_END';});
 text=text.replaceAll('223','224').replace(/REVIEWED_HASH_(\d+)_END/gu,(_match,index)=>hashes[Number(index)]);
 if(file==='reset223-foundation.mjs')text=once(text,'222:182,224:183','222:182,223:183,224:184');
 if(file==='reset223-session.mjs'){
  text=once(text,"export const reset224Marker='RESET224_IN_PROGRESS.json';","export const reset223Marker='RESET223_IN_PROGRESS.json';\nexport const reset224Marker='RESET224_IN_PROGRESS.json';");
  text=once(text,'222:reset222Marker,224:reset224Marker','222:reset222Marker,223:reset223Marker,224:reset224Marker');
 }
 if(file==='trial-reset223-core.mjs'){
  text=once(text,'// RESET224 extends the reviewed retention and write witness to the optional counter schema.','// RESET224 retains the reviewed223 counter schema and adds only the owner inventory reader.');
  text=once(text,'ceiling:224,files:183','ceiling:224,files:184');
 }
 if(file==='frankfurt-owner-reset223.mjs'){
  text=once(text,'migrationCeiling:224,migrations:183','migrationCeiling:224,migrations:184');
  text=once(text,'RESET(?:214|215|217|220|222|224)','RESET(?:214|215|217|220|222|223|224)');
 }
 if(file==='frankfurt-owner-upgrade223.mjs'){
  text=text.replaceAll("'222'","'223'").replaceAll('[182,183]','[183,184]').replaceAll('base.length,182','base.length,183')
   .replaceAll('migrations:183','migrations:184').replaceAll('prefix222Migrations:182','prefix223Migrations:183')
   .replaceAll('BACKUP222_BEFORE','BACKUP223_BEFORE').replaceAll('REQUIRES_COMPLETE222_OR224','REQUIRES_COMPLETE223_OR224');
  text=once(text,'// Owner-operated upgrade from 222 to the optional OFF quantity counter.','// Owner-operated223→224: one additive OFF inventory reader; no table or writer changes.');
  text=once(text,"import {assertReady222Catalog} from './independent-prices222-catalog.mjs';","import {assertReady223Catalog} from './optional-quantity223-catalog.mjs';");
  text=once(text,"if(version==='223')assertReady222Catalog","if(version==='223')assertReady223Catalog");
  text=once(text,"extra['--backup-evidence'],222","extra['--backup-evidence'],223");
 }
 if(file==='upgrade223-protection.mjs'){
  text=once(text,'[222,224]','[223,224]');text=once(text,'ceiling===222?182:183','ceiling===223?183:184');
  text=once(text,'restore.historyFiles,183','restore.historyFiles,184');
 }
 if(file==='upgrade223-data.mjs'){
  text="import assert from 'node:assert/strict';\n\nexport function assert224SourceRowsPreserved(before,after){\n const previous={...before.tables},current={...after.tables};\n delete previous['supabase_migrations.schema_migrations'];\n delete current['supabase_migrations.schema_migrations'];\n // Reader224 adds no relation: every existing counter/event/request stays exact.\n assert.deepEqual(current,previous,'UPGRADE224_EXISTING_APPLICATION_ROWS_CHANGED');\n}\n";
 }
 if(file==='function-reference223.mjs')text=once(text,'functions.length,687','functions.length,688');
 if(file==='d1-reference223-kit.mjs'){
  text=once(text,'ref.manifest.length===183&&ref.functions===687','ref.manifest.length===184&&ref.functions===688');
  text=once(text,'migrations:183,functions:687','migrations:184,functions:688');
  text=once(text,'224/183 ملفاً/687','224/184 ملفاً/688');
  text=once(text,'للاستعمال مع RESET224 فقط بعد بروفة النسخة الفاصلة. لا يشمل توقيعه تنفيذ RESET أو النشر.','للتحقق في ترقية224، ومع RESET224 بعد بروفة النسخة الفاصلة. يُطلب إذن تنفيذ الترقية وRESET والنشر على حدة.');
  text=once(text,'[214,215,216,217,219,220,222,224]','[214,215,216,217,219,220,222,223,224]');
  // Keep all predecessor/catalog dependencies, and bind the new reader/helper.
  text=text.replaceAll('optional-quantity224-catalog.mjs','optional-quantity223-catalog.mjs')
   .replaceAll('off-quantity-counter224/catalog224-pins.json','off-quantity-counter223/catalog223-pins.json')
   .replaceAll('224_optional_sales_quantity.sql','223_optional_sales_quantity.sql');
  text=once(text,"'scripts/backup/complete-backup.mjs'];","'scripts/backup/complete-backup.mjs','scripts/operations/inventory224-catalog.mjs','docs/design/inventory224/catalog224-pins.json','supabase/migrations/224_optional_quantity_inventory_reader.sql','scripts/testing/inventory224-local.mjs','scripts/operations/optional-quantity223-catalog.mjs','scripts/operations/d1-reference223-ci.mjs'];");
 }
 if(file==='frankfurt-reference223.mjs'){
  text=text.replaceAll('assertReady222Catalog','assertReady223Catalog').replaceAll("'./independent-prices222-catalog.mjs'","'./optional-quantity223-catalog.mjs'")
   .replaceAll('quantity224Migration','inventory224Migration').replaceAll('assertQuantity224CatalogDelta','assertInventory224CatalogDelta')
   .replaceAll("'./optional-quantity224-catalog.mjs'","'./inventory224-catalog.mjs'");
  text=text.replaceAll('reference.format,33','reference.format,34').replaceAll('manifest.length,183','manifest.length,184').replaceAll("['222','224']","['223','224']")
   .replaceAll("reference.prefixes['222']","reference.prefixes['223']").replaceAll('reference.functions,687','reference.functions,688');
 }
 if(file==='build-acl-reference223.mjs'){
  text=text.replaceAll('capture-optional-quantity224-catalog.mjs','capture-inventory224-catalog.mjs').replaceAll('NAWASRAH_CHECK_CATALOG224_PINS','NAWASRAH_CHECK_INVENTORY224_PINS');
  text=once(text,"222:prefix(await read('catalog222')","223:prefix(await read('catalog223')");
  text=once(text,'format:33,migrationCeiling:224','format:34,migrationCeiling:224');
  text=once(text,'migrations:183,functions:687','migrations:184,functions:688');
 }
 if(file==='d1-reference223-ci.mjs'){
  text=text.replaceAll('verify222Ci','verify223Ci').replaceAll("'./d1-reference222-ci.mjs'","'./d1-reference223-ci.mjs'");
  text=once(text,"const name='Nawasrah optional quantity224';","const name='Nawasrah inventory224';");
  text=once(text,"['Optional224 database and browser lifecycle','Optional224 owner protection and RESET']","['Inventory224 reader and full-mode preservation','Inventory224 owner protection and RESET']");
 }
 output.set(file.replaceAll('223','224'),text);
}
for(const[name,text]of output){const target=new URL('scripts/operations/'+name,root);if(check)assert.equal(canonicalLf(await readFile(target,'utf8')),text,'GENERATED224_TOOL_DRIFT:'+name);else await writeFile(target,text);}
console.log(JSON.stringify({ok:true,checkOnly:check,files:[...output.keys()]}));
