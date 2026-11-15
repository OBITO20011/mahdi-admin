// Generate versioned 223 owner adapters from exact reviewed 222 sources.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';
import {sourceBeforeOptionalQuantity223} from '../audit/source-before-optional-quantity223.mjs';

const root=new URL('../../',import.meta.url);
const pins=JSON.parse(await readFile(new URL('docs/design/off-quantity-counter223/tool222-source-pins.json',root),'utf8'));
const check=process.argv[2]==='--check';
assert.ok(process.argv.length===2||process.argv.length===3&&check,'ONLY_CHECK_OPTION');
function once(text,from,to){
 assert.equal(text.split(from).length,2,'EXACT223_TOOL_HUNK:'+from.slice(0,100));
 return text.replace(from,()=>to);
}
const output=new Map();
for(const [file,digest] of Object.entries(pins)){
 let text=sourceBeforeOptionalQuantity223('scripts/operations/'+file,
  canonicalLf(await readFile(new URL('scripts/operations/'+file,root),'utf8')));
 assert.ok(text!==null,'EXACT223_TOOL_SOURCE_REQUIRED:'+file);
 assert.equal(sha256(text),digest,'EXACT223_TOOL_SOURCE:'+file);
 const name=file.replaceAll('222','223');
 text=text.replaceAll('222','223');
 if(file==='reset222-foundation.mjs'){
  text=once(text,'220:181,223:182','220:181,222:182,223:183');
  text=text.replaceAll("'sales_lite1','sales_lite2'","'sales_lite1','sales_lite2','sales_lite3'");
  text=once(text,' DROP SCHEMA IF EXISTS sales_lite2 CASCADE;',
   ' DROP SCHEMA IF EXISTS sales_lite3 CASCADE;\n DROP SCHEMA IF EXISTS sales_lite2 CASCADE;');
 }
 if(file==='reset222-write-guard.mjs'){
  text=text.replaceAll("'sales_lite1','sales_lite2'","'sales_lite1','sales_lite2','sales_lite3'");
 }
 if(file==='reset222-session.mjs'){
  text=once(text,"export const reset223Marker='RESET223_IN_PROGRESS.json';",
   "export const reset222Marker='RESET222_IN_PROGRESS.json';\nexport const reset223Marker='RESET223_IN_PROGRESS.json';");
  text=once(text,'220:reset220Marker,223:reset223Marker','220:reset220Marker,222:reset222Marker,223:reset223Marker');
 }
 if(file==='trial-reset222-core.mjs'){
  text=once(text,'// Independent223 engine: reviewed220 retention/private fence plus four additive functions.',
   '// RESET223 extends the reviewed retention and write witness to the optional counter schema.');
  text=once(text,'ceiling:223,files:182','ceiling:223,files:183');
 }
 if(file==='frankfurt-owner-reset222.mjs'){
  text=once(text,'migrationCeiling:223,migrations:182','migrationCeiling:223,migrations:183');
  text=once(text,'RESET(?:214|215|217|220|223)','RESET(?:214|215|217|220|222|223)');
  text=once(text,'report.functions=await functionReference(executor);',
   'report.functions=await functionReference(readOnly,reference,session.saved.catalog);');
 }
 if(file==='frankfurt-owner-upgrade222.mjs'){
  text=text.replaceAll("'220'","'222'").replaceAll('[181,182]','[182,183]').replaceAll('base.length,181','base.length,182')
   .replaceAll('migrations:182','migrations:183').replaceAll('prefix220Migrations:181','prefix222Migrations:182')
   .replaceAll('BACKUP220_BEFORE','BACKUP222_BEFORE').replaceAll('REQUIRES_COMPLETE220_OR223','REQUIRES_COMPLETE222_OR223');
  text=once(text,'// Owner-approved pre-launch223: additive explicit-price writers after220.',
   '// Owner-operated upgrade from 222 to the optional OFF quantity counter.');
  text=once(text,"import {assertReady220Catalog} from './frankfurt-reference220.mjs';",
   "import {assertReady222Catalog} from './independent-prices222-catalog.mjs';");
  text=once(text,"if(version==='222')assertReady220Catalog","if(version==='222')assertReady222Catalog");
  text=once(text,"extra['--backup-evidence'],220","extra['--backup-evidence'],222");
 }
 if(file==='upgrade222-protection.mjs'){
  text=once(text,'[220,223]','[222,223]');
  text=once(text,'ceiling===220?181:182','ceiling===222?182:183');
  text=once(text,'restore.historyFiles,182','restore.historyFiles,183');
 }
 if(file==='d1-reference222-kit.mjs'){
  text=once(text,'ref.manifest.length===182&&ref.functions===683','ref.manifest.length===183&&ref.functions===687');
  text=once(text,'migrations:182,functions:683','migrations:183,functions:687');
  text=once(text,'223/182 ملفاً/683','223/183 ملفاً/687');
  text=once(text,'[214,215,216,217,219,220,223]','[214,215,216,217,219,220,222,223]');
  text=once(text,"'scripts/operations/independent-prices223-catalog.mjs','docs/design/independent-parcel-prices223/catalog223-pins.json','scripts/operations/independent-prices223-capture.mjs','scripts/testing/independent-prices223-local.mjs'",
   "'scripts/operations/independent-prices222-catalog.mjs','docs/design/independent-parcel-prices222/catalog222-pins.json','scripts/testing/independent-prices222-local.mjs','scripts/operations/optional-quantity223-catalog.mjs','docs/design/off-quantity-counter223/catalog223-pins.json','supabase/migrations/223_optional_sales_quantity.sql','scripts/operations/frankfurt-owner-upgrade223.mjs','scripts/operations/upgrade223-data.mjs','scripts/operations/upgrade223-protection.mjs','scripts/backup/complete-backup.mjs'");
 }
 output.set(name,text);
}
for(const [name,text] of output){
 const target=new URL('scripts/operations/'+name,root);
 if(check)assert.equal(canonicalLf(await readFile(target,'utf8')),text,'GENERATED223_TOOL_DRIFT:'+name);
 else await writeFile(target,text);
}
console.log(JSON.stringify({ok:true,checkOnly:check,files:[...output.keys()]}));
