// Build-time literal SQL only. No database introspection or dynamic function DDL.
// Only the owner's permitted OFF-private sales_lite2 leaves are changed.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';
const root=new URL('../../',import.meta.url),source=canonicalLf(readFileSync(new URL('supabase/migrations/220_sales_only_operating_mode.sql',root),'utf8'));
assert.equal(sha256(source),'08bcd03ce79dc1421a49b66c7a0c44cabfda4673adbefc9707afddfde7ef49fa');
assert.ok(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--check','ONLY_CHECK_OPTION');
const blocks=[];
for(const name of ['pos','catalog_page','parcel_options']){
 const start=source.indexOf('CREATE FUNCTION sales_lite2.'+name+'(');
 assert.ok(start>0);const next=source.indexOf('REVOKE ALL ON FUNCTION sales_lite2.'+name+'(',start);
 assert.ok(next>start);let block=source.slice(start,next).trimEnd();
 assert.equal(block.split('CREATE FUNCTION').length,2,'PRIVATE223_ONE_FUNCTION_BLOCK');
 block=block.replace('CREATE FUNCTION sales_lite2.','CREATE OR REPLACE FUNCTION sales_lite2.');
 if(name==='pos'){
  const before=" END LOOP;\n IF p_request?'initialPayment' THEN";
  assert.equal(block.split(before).length,2,'PRIVATE223_POS_INSERTION_CHANGED');
  block=block.replace(before," END LOOP;\n unavailable:=sales_lite3.confirm_plan223(plan,unavailable,p_request->'unavailableConfirmed');\n IF p_request?'initialPayment' THEN");
 }else{
  assert.equal(block.split('sales_lite1.available(').length,name==='catalog_page'?2:4,'PRIVATE223_AVAILABILITY_CALLS_CHANGED');
  block=block.replaceAll('sales_lite1.available(','sales_lite3.effective_available223(');
 }
 blocks.push(block);
}
const output=new URL('docs/design/off-quantity-counter223/private-writers223.sql',root);
const text='-- Generated explicit OFF-private leaves only;no frozen public body or ON dispatch changes.\nBEGIN;\n'+blocks.join('\n\n')+'\nCOMMIT;\n';
if(process.argv.includes('--check'))assert.equal(readFileSync(output,'utf8'),text,'PRIVATE223_SQL_REFRESH_REQUIRED');
else writeFileSync(output,text);
console.log(JSON.stringify({ok:true,privateLeaves:3,sqlSha256:sha256(text),checkOnly:process.argv.includes('--check')}));
