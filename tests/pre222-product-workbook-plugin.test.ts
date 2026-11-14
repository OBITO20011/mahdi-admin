import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pre222ProductWorkbookSourcePlugin} from '../scripts/testing/pre222-product-workbook-plugin.mjs';
test('real esbuild accepts the strict legacy source plugin and compiles the actual old219/220 workbook writer path',async()=>{
 const result=await build({entryPoints:['src/services/supabase/productWorkbook.service.ts'],bundle:true,write:false,platform:'browser',format:'esm',plugins:[pre222ProductWorkbookSourcePlugin()],logLevel:'silent'});
 const text=result.outputFiles[0].text;
 assert.match(text,/create_product_family_with_flavors_v2/u);assert.match(text,/update_product_master_v5/u);assert.match(text,/import_go_live_products_v1/u);
 assert.doesNotMatch(text,/create_product_family_with_flavors_v3|update_product_master_v6|create_product_with_opening_stock_v6/u);
});
