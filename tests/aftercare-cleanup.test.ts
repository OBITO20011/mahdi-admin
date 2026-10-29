import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {supplierPacketQuantity,supplierDecisionHelp} from '../src/features/inventory/supplierReplacementPresentation';
import {wizard215Scenario} from '../e2e/aftercare215-wizard.fixture';
import {buildWizard215,selectWizardPhysical215,physicalKey215,type WizardRequest215} from '../src/features/orders/aftercare215Draft';
import {aftercareCleanupSourcePins,sourceBeforeAftercareCleanup} from '../scripts/audit/source-before-aftercare-cleanup.mjs';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('supplier display uses saved parcel factor and exact packet totals without mutating stored units',()=>{
  assert.equal(supplierPacketQuantity(14,12),'1 طرد + 2 باكيت');
  assert.equal(supplierPacketQuantity(6),'6 باكيت');assert.equal(supplierPacketQuantity(0,12),'0 باكيت');
  assert.equal(supplierPacketQuantity(9007199254740993n,12),'750599937895082 طرد + 9 باكيت');
  for(const q of [-1,1.2,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>supplierPacketQuantity(q));
  assert.throws(()=>supplierPacketQuantity(1,0));
  assert.match(supplierDecisionHelp.receive,/المخزون، بلا مال/u);assert.match(supplierDecisionHelp.credit,/بحد ما عليك له/u);
});
test('a named previous replacement can be selected without consuming the original root buckets',()=>{
  const {order,context}=wizard215Scenario('prior-leaf'),before=structuredClone(context),item=context.baseItems[0];
  const leaf=item.physicalRepresentatives.find(s=>s.sourceKind==='replacement_item')!;
  const selection={kind:'base' as const,orderItemId:item.orderItemId,quantity:1,unit:'packets' as const,replacementSourceId:leaf.sourceId};
  const physical=selectWizardPhysical215(order,context,selection);assert.equal(physical.length,1);assert.equal(physical[0].source.source_id,leaf.sourceId);assert.equal(physical[0].original,false);
  const input:WizardRequest215={selection,inspection:{[physicalKey215(physical[0].source)]:{bad:1,customerDamage:0}},intent:'replace',replacement:'same',supplierByProduct:{},destination:'final',ownerAllowed:true,reason:'باكيت بديل معيب',notes:'',refundMethod:'cash',referenceNumber:'',productId:'',replacementKind:'base_unit',replacementQuantity:1,differenceMethod:'cash'};
  const result=buildWizard215(order,context,input);assert.equal(result.action,'inspected_replacement');
  if(result.action!=='inspected_replacement')throw Error('kind');
  assert.deepEqual(result.payload.items,[{sourceKind:'replacement_item',sourceId:leaf.sourceId,quantity:1,goodQuantity:0,supplierId:null}]);assert.deepEqual(context,before);
  assert.throws(()=>selectWizardPhysical215(order,context,{...selection,replacementSourceId:item.orderItemId}),/لم يعد متاحاً/u);
  assert.throws(()=>selectWizardPhysical215(order,context,{...selection,quantity:3}));
  assert.throws(()=>selectWizardPhysical215(order,context,{...selection,unit:'parcels'}),/لم يعد متاحاً/u);
  assert.throws(()=>buildWizard215(order,context,{...input,intent:'refund'}),/تبديل معيب فقط/u);
});
test('a prior formed flavor replacement keeps the exact saved lineage and component identity',()=>{
  const {order,context}=wizard215Scenario('formed'),parcel=context.parcelInstances[0],component=parcel.components[0];
  component.physicalRepresentatives[0].remainingQuantity=4;
  const sourceId='92600000-0000-4000-8000-000000000090';
  component.physicalRepresentatives.push({sourceKind:'replacement_item',sourceId,productId:component.productId,remainingQuantity:1,parentReplacementItemId:null});
  const selection={kind:'formed' as const,parcelInstanceId:parcel.parcelInstanceId,componentId:component.parcelComponentId,quantity:1,replacementSourceId:sourceId};
  const result=selectWizardPhysical215(order,context,selection);assert.equal(result.length,1);assert.equal(result[0].source.source_id,sourceId);assert.equal(result[0].source.root_source_id,component.parcelComponentId);
  assert.throws(()=>selectWizardPhysical215(order,context,{...selection,componentId:undefined}),/اختر نكهة/u);
  assert.throws(()=>selectWizardPhysical215(order,context,{...selection,componentId:parcel.components[1].parcelComponentId}),/لم يعد متاحاً/u);
});
test('invoice has one current wizard, recoveries for all old actions and a lazy three-state damage list',()=>{
  const panel=read('src/features/orders/AdminAftercarePanel.tsx');
  assert.equal((panel.match(/<AftercareWizard215 /gu)||[]).length,1);
  assert.doesNotMatch(panel,/setReturnDraft|setReplacementSource|settleAdminReturn|settleAdminReplacement|القدرات السابقة|استبدال وحدة|تبديل حبة/u);
  for(const s of ["runRecovery('return')","runRecovery('replacement')","'sealed_return'","'inspected_replacement'","'exchange'",'submitSupplierReplacement(supplierScope)','<AftercareSupplierSafety recoveryOnly','<DamageHistoryPanel/>'])assert.ok(panel.includes(s),s);
  assert.match(panel,/damageOpen&&<fieldset disabled=/u);assert.match(panel,/سجل المحل كله/u);
  const wizard=read('src/features/orders/AftercareWizard215.tsx');assert.equal((wizard.match(/ownerAllowed&&intent==='replace'/gu)||[]).length,2);assert.match(wizard,/replacementSourceId:source.sourceId/u);
});
test('cleanup historical projection is bound to approved216 bytes and never erases an unknown mutation',()=>{
  assert.equal(aftercareCleanupSourcePins.baseline,'015ffcae98da6241514cd8ab3b646dd2993c9eb2');
  for(const [file,pin] of Object.entries(aftercareCleanupSourcePins.entries) as [string,{after:string;before:string|null;beforeText:string|null}][]){
    const current=read(file);assert.equal(hash(current),pin.after,file);assert.equal(sourceBeforeAftercareCleanup(file,current),pin.beforeText,file);
    if(pin.beforeText!==null){assert.equal(hash(pin.beforeText),pin.before);assert.equal(pin.beforeText,execFileSync('git',['show',aftercareCleanupSourcePins.baseline+':'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n'));}
    const unknown=current+'\n// unexpected mutation\n';assert.equal(sourceBeforeAftercareCleanup(file,unknown),unknown);
  }
});
