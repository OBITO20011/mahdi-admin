import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDamageLedger215,damageLedgerPeriod215} from '../src/utils/damageLedger215';
import {damage215Page,nonOwnerDamage215Page} from '../e2e/aftercare215-damage.fixture';
import {readReplacementCase} from '../src/utils/supplierReplacement';
test('215 damage DTO retains three quantity states once and signed loss from source movements only',()=>{
  const page=parseDamageLedger215(damage215Page,true);assert.equal(page.rows[0].quantity,14);assert.equal(page.rows[0].historicalParcelSize,12);assert.equal(page.periodLossInMinorUnits,'6000');
  assert.equal(page.rows[0].states.reduce((sum,s)=>sum+s.quantity,0),14);assert.equal(page.rows[0].owner?.periodLossInMinorUnits,'6000');
  for(const patch of [{quantity:15},{historicalParcelSize:null},{states:[...damage215Page.rows[0].states,...damage215Page.rows[0].states]},{periodLossInMinorUnits:'6001'}])assert.throws(()=>parseDamageLedger215({...damage215Page,rows:[{...damage215Page.rows[0],...patch}]},true));
});
test('215 damage DTO rejects any owner group or monetary movement on a non-owner response',()=>{
  const safe=nonOwnerDamage215Page();assert.equal(parseDamageLedger215(safe,false).rows[0].owner,undefined);assert.throws(()=>parseDamageLedger215(damage215Page,false));assert.throws(()=>parseDamageLedger215(safe,true));
  const raw=safe as any;for(const key of ['unitCostInMinorUnitsExact','periodLossInMinorUnits','costDifferenceInMinorUnits','actions']){const mutated=structuredClone(raw);mutated.rows[0][key]=key==='actions'?{}:'500';assert.throws(()=>parseDamageLedger215(mutated,false));}
  const nested=structuredClone(raw);nested.rows[0].movements[0].lossDeltaInMinorUnits='1';assert.throws(()=>parseDamageLedger215(nested,false));
});
test('215 unknown historical parcel size and financial-only recovery never fabricate damaged quantities',()=>{
  const raw=structuredClone(damage215Page) as any;raw.rows[0].parcelSizeKnown=false;raw.rows[0].historicalParcelSize=null;assert.equal(parseDamageLedger215(raw,true).rows[0].historicalParcelSize,null);
  Object.assign(raw.rows[0],{source:'replacement',quantity:0,pendingQuantity:0,receivedQuantity:0,finishedSupplierQuantity:0,finalOwnerQuantity:0,states:[],financialOnly:true,periodLossInMinorUnits:'-500',costDifferenceInMinorUnits:'-500'});
  raw.rows[0].movements=[{...raw.rows[0].movements[0],quantity:0,lossDeltaInMinorUnits:'-500'}];raw.periodLossInMinorUnits='-500';
  const page=parseDamageLedger215(raw,true);assert.equal(page.rows[0].quantity,0);assert.deepEqual(page.rows[0].states,[]);assert.equal(page.periodLossInMinorUnits,'-500');
});
test('215 loss and fractional unit cost remain exact text beyond the safe Number range',()=>{
  const raw=structuredClone(damage215Page) as any;raw.periodLossInMinorUnits='9007199254740993';raw.rows[0].periodLossInMinorUnits=raw.periodLossInMinorUnits;raw.rows[0].unitCostInMinorUnitsExact='1000.600000';
  raw.rows[0].movements=[{...raw.rows[0].movements[0],lossDeltaInMinorUnits:raw.periodLossInMinorUnits}];assert.equal(parseDamageLedger215(raw,true).periodLossInMinorUnits,'9007199254740993');
  raw.rows[0].periodLossInMinorUnits=Number(raw.periodLossInMinorUnits);assert.throws(()=>parseDamageLedger215(raw,true));
});
test('215 damage dates use Amman inclusive days and match the preceding six-day/week contract',()=>{
  const now=new Date('2026-10-27T22:00:00Z');assert.deepEqual(damageLedgerPeriod215('today',undefined,undefined,now),{from:'2026-10-27T21:00:00.000Z',to:'2026-10-28T21:00:00.000Z'});
  assert.equal(damageLedgerPeriod215('week',undefined,undefined,now).from,'2026-10-21T21:00:00.000Z');assert.equal(damageLedgerPeriod215('month',undefined,undefined,now).from,'2026-09-30T21:00:00.000Z');
  assert.deepEqual(damageLedgerPeriod215('range','2026-10-28','2026-10-28',now),damageLedgerPeriod215('today',undefined,undefined,now));
  for(const [a,b]of [['2026-02-30','2026-03-01'],['2026-10-29','2026-10-28'],['2024-01-01','2026-01-01']])assert.throws(()=>damageLedgerPeriod215('range',a,b,now));
});
test('215 supplier case reader accepts inspected origin and credited quantity while preserving non-owner quantity DTO',()=>{
  const row={id:'a',supplierId:'b',supplierName:'مورد',productId:'c',productName:'صنف',warehouseId:'d',branchId:'e',origin:'inspected_replacement',quantity:1,commercialQuantity:1,unitsPerCommercialUnit:1,unitName:'باكيت',baseUnitName:'باكيت',pendingQuantity:0,receivedQuantity:0,writtenOffQuantity:0,creditedQuantity:1,occurredAt:'2026-10-28T09:00:00Z',
    events:[{id:'f',action:'credit',quantity:1,heldDelta:-1,occurredAt:'2026-10-28T09:00:00Z',isReversed:false,reversesEventId:null}]};
  assert.equal(readReplacementCase(row).creditedQuantity,1);assert.equal(readReplacementCase(row).supplierCreditInMinorUnits,undefined);
  assert.equal(readReplacementCase({...row,unitCostInMinorUnitsExact:'500.000000',pendingValueInMinorUnitsExact:'0',supplierCreditInMinorUnits:'500'}).supplierCreditInMinorUnits,'500');
  assert.throws(()=>readReplacementCase({...row,supplierCreditInMinorUnits:'500'}));assert.throws(()=>readReplacementCase({...row,creditedQuantity:2}));
});
