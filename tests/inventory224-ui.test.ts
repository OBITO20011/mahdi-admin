import assert from 'node:assert/strict';
import test from 'node:test';
import {parseInventory224,normalizeInventorySearch,receivedQuantity224} from '../src/features/operatingMode/inventory224Contract';
const id='92600000-0000-4000-8000-000000000103';
const row={productId:id,name:'صنف',flavorName:null,familyId:null,familyName:null,sku:'NW-0103',barcode:'00103',unitId:id,unitName:'باكيت',enabled:true,quantity:2,threshold:4,revision:1,updatedAt:'2026-11-16T00:00:00Z',status:'low',lastEvent:{kind:'sale',delta:-3,at:'2026-11-16T00:00:00Z',actorDisplayName:null,source:'website'}};
const request={search:'',filter:'all' as const,page:1,pageSize:20};
const fixture=()=>({contractVersion:'inventory224-v1',fullAccounting:false,counts:{tracked:3,low:2,zero:1},total:1,page:1,pageSize:20,items:[structuredClone(row)]});
test('inventory search normalizes Arabic/Persian digits and whitespace without changing identifiers',()=>{
 assert.equal(normalizeInventorySearch('  NW-٠٢٦٨  '),'NW-0268');
 assert.equal(normalizeInventorySearch('۰۰۱۲  \t  باكيت'),'0012 باكيت');
 assert.equal(normalizeInventorySearch('00012%_'),'00012%_');
});
test('received amount is an absolute CAS intent; overflow/fractions cannot save',()=>{
 assert.equal(receivedQuantity224(2,24),26);
 for(const value of [null,-1,1.5,1_000_000_000])assert.equal(receivedQuantity224(2,value),null);
});
test('inventory response enforces counters, global counts, filter, identity and event contract',()=>{
 assert.equal(parseInventory224(fixture(),request).items[0].lastEvent?.delta,-3);
 for(const change of [
  (v:ReturnType<typeof fixture>)=>{v.counts.zero=3;},
  (v:ReturnType<typeof fixture>)=>{v.items.push(v.items[0]);},
  (v:ReturnType<typeof fixture>)=>{v.items[0].status='available';},
  (v:ReturnType<typeof fixture>)=>{v.items[0].lastEvent.delta=0.5;},
  (v:ReturnType<typeof fixture>)=>{v.items[0].unitId='missing';},
 ]){const value=fixture();change(value);assert.throws(()=>parseInventory224(value,request));}
 assert.throws(()=>parseInventory224(fixture(),{...request,filter:'zero'}));
});
