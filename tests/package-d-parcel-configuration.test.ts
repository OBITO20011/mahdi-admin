import test from 'node:test';
import assert from 'node:assert/strict';
import {parseParcelConfigurationContext, validateParcelConfiguration, type ParcelConfigurationProduct} from '../src/services/supabase/parcelConfiguration.service';
const family='11111111-1111-4111-8111-111111111111', child='22222222-2222-4222-8222-222222222222';
const product: ParcelConfigurationProduct={familyProductId:family,nameAr:'عائلة',sku:'D3',isFlavorMaster:true,unitsPerParcel:5,parcelPriceInMinorUnits:10000,
  configuration:null,allowedProductIds:[],components:[{productId:family,nameAr:'عائلة',sku:'D3',flavorNameAr:null},{productId:child,nameAr:'نكهة',sku:'D3-A',flavorNameAr:'نكهة'}]};
test('parcel settings retain authoritative identity, cost-independent price and closed feature state',()=>{
  const data={featureState:'OFF',products:[product]};const parsed=parseParcelConfigurationContext(data);
  parsed.products[0].nameAr='changed';assert.equal(data.products[0].nameAr,'عائلة');
  for(const value of [{...data,featureState:'on'},{...data,products:[product,product]},
    {...data,products:[{...product,allowedProductIds:[child,child]}]},
    {...data,products:[{...product,unitsPerParcel:null}]}]) assert.throws(()=>parseParcelConfigurationContext(value));
  for(const price of [-1,1.5,NaN]) assert.throws(()=>parseParcelConfigurationContext({...data,products:[{
    ...product,components:[{...product.components[0],packetPriceInMinorUnits:price}]}]}));
  assert.doesNotThrow(()=>parseParcelConfigurationContext({...data,products:[{
    ...product,components:[{...product.components[0],packetPriceInMinorUnits:0}]}]}));
});
test('configuration rejects wrong family, unknown or duplicate flavor, empty active capacity and invalid mode',()=>{
  const good={familyProductId:family,mode:'configurable_mix' as const,active:true,units:5,allowed:[child]};
  assert.doesNotThrow(()=>validateParcelConfiguration(good,product));
  for(const value of [{...good,familyProductId:child},{...good,units:0},{...good,units:1.5},
    {...good,allowed:[]},{...good,allowed:[child,child]},{...good,allowed:['33333333-3333-4333-8333-333333333333']},
    {...good,mode:'single_sku' as const}]) assert.throws(()=>validateParcelConfiguration(value,product));
  assert.doesNotThrow(()=>validateParcelConfiguration({...good,mode:'single_sku',allowed:[family]},product));
  assert.throws(()=>validateParcelConfiguration(good,{...product,isFlavorMaster:false}));
});
