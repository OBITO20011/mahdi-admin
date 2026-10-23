import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldRestorePosSearchFocus} from '../src/features/pos/posSearchFocus';

test('touch, coarse and narrow pointer additions do not summon a search keyboard',()=>{
  for(const device of [{coarse:true,touchPoints:0,width:1440},{coarse:false,touchPoints:5,width:1440},
    {coarse:false,touchPoints:0,width:390}]){
    assert.equal(shouldRestorePosSearchFocus('pointer',device),false);
    assert.equal(shouldRestorePosSearchFocus('search',device),true);
    assert.equal(shouldRestorePosSearchFocus('barcode',device),true);
  }
  assert.equal(shouldRestorePosSearchFocus('pointer',{coarse:false,touchPoints:0,width:1440}),true);
});
