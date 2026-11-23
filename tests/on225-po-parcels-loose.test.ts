import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {purchaseReceiptV2Lines} from '../src/utils/receivingV2';

// Owner item 11 (PO part): parcels and loose base units of the same PO line
// must travel as ONE receipt line; the server rejects a repeated PO item.
const product='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',item='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const base={purchaseOrderItemId:item,productId:product,unitCost:0,baseUnitName:'باكيت'};

test('parcels plus loose units become one line with the exact summed gross',()=>{
 const lines=purchaseReceiptV2Lines([{...base,receivedQuantity:2*24+5,packagePricing:{packageQuantity:2,unitsPerPackage:24,packagePriceInMinorUnits:12000,looseQuantity:5,looseUnitPriceInMinorUnits:550}}]);
 assert.equal(lines.length,1);
 assert.equal(lines[0].purchase_order_item_id,item);
 assert.equal(lines[0].commercial_quantity,53);
 assert.equal(lines[0].components[0].base_quantity,53);
 assert.equal(lines[0].gross_amount_in_minor_units,2*12000+5*550);
 assert.equal(lines[0].line_discount_in_minor_units,0);
});

test('without loose fields the parcel payload is byte-identical to before',()=>{
 const quote={packageQuantity:1,unitsPerPackage:24,packagePriceInMinorUnits:1000};
 assert.equal(JSON.stringify(purchaseReceiptV2Lines([{...base,receivedQuantity:24,packagePricing:quote}])),
  JSON.stringify(purchaseReceiptV2Lines([{...base,receivedQuantity:24,packagePricing:{...quote,looseQuantity:0,looseUnitPriceInMinorUnits:0}}])));
});

test('loose quantity that does not add up, or is not a whole number, fails closed',()=>{
 const quote={packageQuantity:1,unitsPerPackage:24,packagePriceInMinorUnits:1000,looseQuantity:5,looseUnitPriceInMinorUnits:50};
 assert.throws(()=>purchaseReceiptV2Lines([{...base,receivedQuantity:24,packagePricing:quote}]),/لا تطابق/);
 assert.throws(()=>purchaseReceiptV2Lines([{...base,receivedQuantity:29,packagePricing:{...quote,looseQuantity:4.5}}]));
 assert.throws(()=>purchaseReceiptV2Lines([{...base,receivedQuantity:29,packagePricing:{...quote,looseUnitPriceInMinorUnits:-1}}]));
});

test('the PO receiving screen offers loose units inside the same line, never a second line',()=>{
 const s=readFileSync('src/features/purchases/ReceiveGoodsModal.tsx','utf8');
 assert.match(s,/فرط لنفس الصنف/u);
 assert.match(s,/looseQuantity:i\.looseQuantity,looseUnitPriceInMinorUnits:jodToMinorUnits\(i\.looseUnitCostJod\)/u);
 assert.match(s,/Math\.floor\(\(item\.remainingQuantity-item\.looseQuantity\)\/item\.unitsPerPackage\)/u);
 assert.doesNotMatch(s,/addCompanionLine|purchaseOrderItemId:crypto/u);
});
