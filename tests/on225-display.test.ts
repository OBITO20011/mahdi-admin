import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {posStockShortageCopy,POS_STOCK_CHANGED_COPY} from '../src/utils/posStockCopy';
import {mapCatalogProduct} from '../customer-web/src/services/catalog.service';
import {createCartItem,createBaseUnitCartItem} from '../customer-web/src/utils/cart';
import {cartUnitPresentation} from '../customer-web/src/utils/cartUnitPresentation';
import {buildGuestOrderV2Lines} from '../customer-web/src/utils/checkout';
import {storefrontSaleUnit,storefrontPackageDescription,storefrontCartPackageDescription} from '../customer-web/src/utils/storefrontUnits';
import {receiptLineDescription} from '../customer-web/src/receipts/commercialReceipt';
import {sourceBeforeOnUnitDisplay225,onUnitDisplay225Pins} from '../scripts/audit/source-before-on-unit-display225.mjs';

test('display projection retains literal historical source and refuses an unknown byte',()=>{
 for(const [file,pin] of Object.entries(onUnitDisplay225Pins)){
  const current=readFileSync(file,'utf8').replace(/\r\n?/gu,'\n');
  assert.equal(sourceBeforeOnUnitDisplay225(file,current),pin.beforeText,file);
  assert.equal(sourceBeforeOnUnitDisplay225(file,current+'\nUNKNOWN_BYTE'),current+'\nUNKNOWN_BYTE',file);
 }
});

test('ON stock copy names the item and exact commercial units with Latin digits',()=>{
 assert.equal(posStockShortageCopy('كندر بوينو عادي','باكيت',0,1),'نفد المخزون: كندر بوينو عادي — المتاح 0 باكيت');
 assert.equal(posStockShortageCopy('مياه','قنينة',2,3),'المتاح من مياه: 2 قنينة، والمطلوب 3');
 assert.equal(posStockShortageCopy('جملة','صندوق',1000,1001),'المتاح من جملة: 1,000 صندوق، والمطلوب 1,001');
 assert.equal(POS_STOCK_CHANGED_COPY,'تغيّر المخزون قبل إتمام البيع. حدّث المتاح وراجع السلة');
});
test('ON live cart names are a render-only projection; raw storage and guest RPC payload stay identical',()=>{
 const product=mapCatalogProduct({id:'12800000-0000-4000-8000-000000000001',sku:'ON-UNIT',nameAr:'مياه وهمية',unitNameAr:'قنينة',saleUnitNameAr:'صندوق',unitsPerSalePackage:12,salePackagePriceInMinorUnits:12000,salePriceInMinorUnits:1000,availableQuantity:48,availableSalePackages:4,isAvailable:true});
 const items=[createCartItem(product),createBaseUnitCartItem(product)],before=JSON.stringify(items),payload=buildGuestOrderV2Lines(items);
 const rendered=cartUnitPresentation(items,[product]);
 assert.equal(storefrontSaleUnit(product),'صندوق');assert.equal(storefrontPackageDescription(product),'صندوق (12 قنينة)');
 assert.equal(storefrontCartPackageDescription(rendered[0]),'صندوق (12 قنينة)');
 assert.equal(storefrontCartPackageDescription(rendered[1]),'قنينة');
 assert.deepEqual(buildGuestOrderV2Lines(rendered),payload);assert.equal(JSON.stringify(items),before);
 assert.deepEqual(rendered.map(x=>[x.quantity,x.unitPriceInMinorUnits]),[[1,12000],[1,1000]]);
 const cartSource='customer-web/src/utils/cart.ts';
 assert.equal(readFileSync(cartSource,'utf8').replace(/\r\n?/gu,'\n'),execFileSync('git',['show','a74070de:'+cartSource],{encoding:'utf8'}).replace(/\r\n?/gu,'\n'));
});
test('ON receipt labels use immutable base/parcel snapshots; old lines keep their current fallback',()=>{
 for(const unit of ['صندوق','شرنك','كرتونة','كيس','علبة','ربطة','شوال']){
  const line={key:'old',name:'محفوظ',kind:'base_unit',quantity:2,baseQuantity:2,baseUnitName:unit,savedUnitName:'اسم حالي مختلف',totalInMinorUnits:2000};
  const before=JSON.stringify(line);assert.equal(receiptLineDescription(line),'2 '+unit);assert.equal(JSON.stringify(line),before);
 }
 assert.equal(receiptLineDescription({key:'parcel',name:'محفوظ',kind:'legacy_single_sku_parcel',quantity:1,baseQuantity:12,baseUnitName:'قنينة',savedUnitName:'صندوق',totalInMinorUnits:12000}),'1 صندوق (12 قنينة)');
 assert.equal(receiptLineDescription({key:'legacy',name:'قديم',quantity:1,savedUnitName:'كرتونة',totalInMinorUnits:12000}),'1 طرد');
 assert.equal(receiptLineDescription({key:'legacy-base',name:'قديم',kind:'base_unit',quantity:1,totalInMinorUnits:1000}),'1 باكيت');
});
test('the full stock predicate and new POS line object remain byte-identical to approved main',()=>{
 const file='src/features/pos/PosView.tsx',current=readFileSync(file,'utf8').replace(/\r\n?/gu,'\n'),before=execFileSync('git',['show','a74070de:'+file],{encoding:'utf8'}).replace(/\r\n?/gu,'\n');
 const guard=(text:string)=>text.slice(text.indexOf('  const cartFits ='),text.indexOf('  });',text.indexOf('  const cartFits ='))+6);
 const line=(text:string)=>text.slice(text.indexOf('      const newItem: PosCartItem = {'),text.indexOf('\n      };',text.indexOf('      const newItem: PosCartItem = {'))+9);
 assert.equal(guard(current),guard(before));assert.ok(guard(before).includes('quantity <= available'));
 assert.equal(line(current),line(before));assert.ok(line(before).includes('v2Line:'));
});

test('cart presentation is wired without replacing raw checkout or persistence inputs',()=>{
 const checkout=readFileSync('customer-web/src/components/CheckoutModal.tsx','utf8');
 assert.ok(checkout.includes('cartUnitPresentation(displayedItems, presentationProducts)'));
 assert.ok(checkout.includes('receipt || pendingAttempt?.serverState'));
 assert.ok(checkout.includes('buildGuestOrderV2Lines(items)'));
 assert.ok(checkout.includes('coordinator.prepare(request, items)'));
 assert.ok(checkout.includes('calculateCartSubtotal(displayedItems)'));
 const drawer=readFileSync('customer-web/src/components/CartDrawer.tsx','utf8');
 assert.ok(drawer.includes('calculateCartSubtotal(items)'));
 assert.ok(drawer.includes('lockedLineIds.has(item.localLineId)'));
});
