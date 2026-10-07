import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {directReceiptV2Lines, purchaseReceiptV2Lines} from '../src/utils/receivingV2';

const product='e1330000-0000-4000-8000-000000000001';
const client='e1330000-0000-4000-8000-000000000002';

test('Direct purchase package conversion preserves exact gross/discount and stable request identity',()=>{
  const input={clientLineId:client,productId:product,purchaseUnitName:'كرتونة شراء',baseUnitName:'باكيت',
    packageQuantity:2,unitsPerPackage:12,packagePriceInMinorUnits:12000,discountInMinorUnits:500};
  const lines=directReceiptV2Lines([input]);
  assert.equal(lines[0].commercial_quantity,24);assert.equal(lines[0].components[0].base_quantity,24);
  assert.equal(lines[0].gross_amount_in_minor_units,24000);assert.equal(lines[0].line_discount_in_minor_units,500);
  assert.deepEqual(directReceiptV2Lines([input]),lines);
  assert.doesNotMatch(JSON.stringify(lines),/update_product_defaults|sale_price|purchase_unit_id|units_per_purchase_unit/);
  assert.throws(()=>directReceiptV2Lines([{...input,clientLineId:undefined}]));
  assert.throws(()=>directReceiptV2Lines([{...input,unitsPerPackage:1.5}]));
});

test('PO V2 receipt binds its exact PO item and base quantity, not product defaults',()=>{
  const lines=purchaseReceiptV2Lines([{purchaseOrderItemId:client,productId:product,receivedQuantity:3,unitCost:2.123}]);
  assert.equal(lines[0].client_line_id,client);assert.equal(lines[0].purchase_order_item_id,client);
  assert.equal(lines[0].gross_amount_in_minor_units,6369);assert.equal(lines[0].commercial_quantity,3);
  assert.doesNotMatch(JSON.stringify(lines),/sale_price|default_|update_product_defaults/);
});

test('Current UI/services only submit V2 and never offer receiving-time product-default mutation',()=>{
  const direct=readFileSync('src/features/directReceiving/CreateDirectReceiptModal.tsx','utf8');
  const po=readFileSync('src/features/purchases/ReceiveGoodsModal.tsx','utf8');
  assert.doesNotMatch(direct+po,/updateProductDefaults|update_product_defaults|حفظ وحدة الشراء ومحتوى الطرد/);
  assert.match(readFileSync('src/services/supabase/directReceiving.service.ts','utf8'),/supabase\.rpc\('create_direct_supplier_receipt_v2'/);
  assert.match(readFileSync('src/services/supabase/purchases.service.ts','utf8'),/supabase\.rpc\('receive_purchase_order_v2'/);
});
