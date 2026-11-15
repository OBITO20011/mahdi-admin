import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {offParcelPricePresentation} from '../src/utils/offParcelPricePresentation';
import {OffParcelPriceSummary} from '../src/features/products/OffParcelPriceSummary';
import {OffParcelFeatureControl} from '../src/features/more/OffParcelFeatureControl';

test('OFF parcel presentation shows equality, exact discount, and the existing surcharge error',()=>{
  assert.deepEqual(offParcelPricePresentation(8,1900,15200,'باكيت'),{
    formula:'8 باكيت × 1.900 = 15.200 د.أ',detail:'بدون خصم',tone:'equal',
  });
  assert.deepEqual(offParcelPricePresentation(8,1900,14000,'باكيت'),{
    formula:'8 باكيت × 1.900 = 15.200 د.أ',detail:'خصم 1.200 د.أ — باكيت داخل الطرد بـ1.750',tone:'discount',
  });
  const tooHigh=offParcelPricePresentation(8,1900,15201,'باكيت');
  assert.equal(tooHigh.tone,'error');
  assert.equal(tooHigh.detail,'سعر الطرد لا يتجاوز العدد مضروباً في سعر الوحدة.');
  assert.equal(offParcelPricePresentation(8,1900,1900,'باكيت').tone,'error');
  assert.match(offParcelPricePresentation(3,1900,5000,'قنينة').detail,/قنينة داخل الطرد بـ1\.667/u);
  assert.match(offParcelPricePresentation(8,1900,14000,'').formula,/باكيت/u);
});

test('OFF live price feedback has distinct discount, neutral, and error states',()=>{
  const markup=(parcel:number)=>renderToStaticMarkup(React.createElement(OffParcelPriceSummary,{
    units:8,single:1900,parcel,unit:'باكيت',
  }));
  assert.match(markup(14000),/aria-live="polite"[\s\S]*text-nw-ok/u);
  assert.match(markup(15200),/text-nw-muted[\s\S]*بدون خصم/u);
  assert.match(markup(15201),/text-nw-bad[\s\S]*role="alert"/u);
});

test('OFF feature control exposes only enabled/off switching and describes the saved pilot state',()=>{
  const render=(featureState:'OFF'|'OWNER_PILOT'|'ENABLED')=>renderToStaticMarkup(React.createElement(OffParcelFeatureControl,{
    featureState,nextState:featureState,disabled:false,onToggle(){},children:React.createElement('p',null,'التأكيد الحالي'),
  }));
  assert.match(render('OFF'),/role="switch"[\s\S]*aria-checked="false"/u);
  assert.match(render('OFF'),/الزبائن والكاشير ما بيشوفوا أي طرد مشكّل/u);
  assert.match(render('OWNER_PILOT'),/موقوف للزبائن \(تجربة المالك\)/u);
  assert.match(render('ENABLED'),/aria-checked="true"/u);
  assert.doesNotMatch(render('ENABLED'),/الزبائن والكاشير/u);
  for(const state of ['OFF','OWNER_PILOT','ENABLED'] as const){
    assert.doesNotMatch(render(state),/<select|<option/u);
    assert.match(render(state),/التأكيد الحالي/u);
  }
});
