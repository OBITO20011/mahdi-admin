import {projectTrial41Source,trial41Integration} from '../scripts/audit/source-before-trial41-integration.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mapAdminProductRecord} from '../src/services/supabase/products.service';
import {PosProductCard} from '../src/features/pos/PosProductCard';
import {posCartLines,type PosCartItem} from '../src/features/pos/posV2Cart';
import {savedReceiptLine} from '../src/features/receipts/saleReceipt';
import {receiptLineDescription} from '../customer-web/src/receipts/commercialReceipt';
import {trialDItems} from '../e2e/trial-d-receipt.fixture';
import {trialTAPins,sourceBeforeTrialTA} from '../scripts/audit/source-before-trial-ta.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n'),hash=(s:string)=>createHash('sha256').update(s).digest('hex');

test('T-A POS bottle product shows only parcel/packet sales methods and preserves exact outgoing lines',()=>{
 const product=mapAdminProductRecord({id:'12800000-0000-4000-8000-000000000001',name_ar:'صنف وهمي',sku:'TA',base_unit:{code:'BOTTLE',name_ar:'قنينة'},units_per_sale_unit:12,sale_price_in_minor_units:500,default_sale_price_in_minor_units:6000});
 const before=JSON.stringify(product),html=renderToStaticMarkup(React.createElement(PosProductCard,{product,stock:26,parcelQuantity:1,unitQuantity:2,disabled:false,onAdd:()=>undefined,onReduce:()=>undefined}));
 assert.equal(product.unit,'قنينة');assert.match(html,/إضافة باكيت من صنف وهمي/u);assert.match(html,/إضافة طرد من صنف وهمي/u);assert.doesNotMatch(html,/قنينة/u);assert.equal(JSON.stringify(product),before);
 const item:PosCartItem={...trialDItems[3],productId:product.id,unit:'قنينة',baseUnitName:'قنينة',quantity:3,baseQuantity:3,v2Line:{commercial_line_kind:'base_unit',product_id:product.id,base_quantity:3}};
 const snapshot=JSON.stringify(item);assert.equal(receiptLineDescription(savedReceiptLine(item)),'3 باكيت');assert.deepEqual(posCartLines([item]),[{commercial_line_kind:'base_unit',product_id:product.id,base_quantity:3}]);assert.equal(JSON.stringify(item),snapshot);
});

test('T-A exact inverse retains original historical bytes;DB,services and price calculation modules are unchanged',()=>{
 for(const [file,pin]of Object.entries(trialTAPins) as [string,{after:string;added?:boolean}][]){const raw=projectTrial41Source(file,read(file),'trialTA') as string;assert.equal(hash(raw),pin.after,file);const before=sourceBeforeTrialTA(file,raw);if(pin.added)assert.equal(before,null);else assert.equal(before,execFileSync('git',['show','f95ff0458f90298edc21e39859d3268c7f7ccac7:'+file],{encoding:'utf8',maxBuffer:8*1024**2}).replaceAll('\r\n','\n'));}
 assert.throws(()=>sourceBeforeTrialTA('customer-web/src/utils/saleUnitLabels.ts',read('customer-web/src/utils/saleUnitLabels.ts')+'\nvoid unapproved;\n'),/UNREVIEWED_SOURCE/u);
 const unchanged=execFileSync('git',['diff','--name-only',trial41Integration.approvedRefs.previousMain,'--','supabase','src/services','src/features/pos/posV2Cart.ts','customer-web/src/services','customer-web/src/utils/checkout.ts'],{encoding:'utf8'}).trim();assert.equal(unchanged,'');
});

test('T-A current actual SDK evidence binds all new presentation sources without rewriting frozen214 reference',async()=>{
 const current=await inventory(),state=JSON.parse(read('docs/agent/project-state.json')),proof=JSON.parse(read(state.currentTableReadinessEvidence));assert.equal(state.migrationCeiling,214);assert.equal(proof.migrationCeiling,214);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,current.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(current,proof.results));
});
