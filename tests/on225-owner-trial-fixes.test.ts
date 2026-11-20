import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

// Owner ON225 trial findings 2026-11-20. Raw current source only (never a historical projection).
const raw=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');

test('single-unit products can gain a parcel named «طرد» instead of their own content unit',()=>{
 const form=raw('src/features/products/ProductFormModal.tsx');
 assert.match(form,/units\.find\(item => item\.nameAr\.trim\(\) === 'طرد'\)\?\.nameAr/u);
 assert.match(form,/\|\| purchasePackage\.trim\(\) === unit\.trim\(\)\n\s+\? parcelName/u);
 // The «طرد» unit wins over the generic CTN «كرتونة» fallback.
 assert.ok(form.indexOf("item.nameAr.trim() === 'طرد'")<form.indexOf("item.code === 'CTN'"));
});

test('an invoice no longer embeds the shop-wide damage log; it stays in More → التالف',()=>{
 const panel=raw('src/features/orders/AdminAftercarePanel.tsx');
 assert.doesNotMatch(panel,/DamageHistoryPanel|damageOpen|سجل المحل كله/u);
 assert.match(panel,/<AftercareWizard215 /u);
 assert.match(raw('src/features/more/DamageProductSelection.tsx'),/<DamageHistoryPanel\/>/u);
});

test('a cash refund larger than the drawer is warned once before settlement, never blocked',()=>{
 const wizard=raw('src/features/orders/AftercareWizard215.tsx');
 assert.match(wizard,/const drawer=useDrawerShortfallConfirm\(\);/u);
 const confirm=wizard.slice(wizard.indexOf('const confirm=async()=>{'));
 assert.ok(confirm.indexOf('drawer.confirmCash(')<confirm.indexOf('settleAftercare215('));
 assert.match(confirm,/preview\.refundMethod==='cash'\?preview\.moneyRefundInMinorUnits:'0'/u);
 assert.match(wizard,/\{drawer\.warningNode\}/u);
});

test('mixed parcel count shows the product parcel size or asks for a count',()=>{
 const modal=raw('src/features/more/ParcelConfigurationModal.tsx');
 assert.match(modal,/طرد هذا المنتج: \$\{product\.unitsPerParcel\} \$\{contentUnit\(form\.familyProductId\)\}/u);
 assert.match(modal,/لا يوجد طرد معرّف لهذا المنتج — اكتب العدد/u);
});

test('owner withdrawals entry scrolls only its own container and flashes the card',()=>{
 const shifts=raw('src/features/shifts/ShiftsView.tsx');
 assert.doesNotMatch(shifts,/withdrawalsEntry\.current\?\.scrollIntoView/u);
 assert.match(shifts,/card\.focus\(\{preventScroll:true\}\)/u);
 assert.match(shifts,/scroller\.scrollTo\(/u);
});
