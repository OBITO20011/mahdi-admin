import assert from 'node:assert/strict';
import test from 'node:test';
import {orderStorefrontCategories, categoryPresentationKey, STOREFRONT_CATEGORY_ORDER} from '../src/utils/categoryOrder';
import {getCategoryVisual} from '../src/components/categoryVisuals';

const names = ['عروض خاصة', 'شوكلاتة غوالي', 'شوكولاتة', 'كاندي وسكاكر',
  'شيبس وتسالي', 'بسكويت وويفر', 'بسكويت 10 قروش', 'كيك', 'علكة',
  'مشروبات وعصائر', 'مشروبات طاقة', 'مياه', 'مواد غذائية', 'علب هدايا'];

test('owner ordering survives arbitrary import codes and ignores product counts', () => {
  const categories = [...names, 'أخرى'].map((nameAr, index) => ({nameAr, code: 'CUTOVER-'+index, productCount: 99-index}));
  const reversed = [...categories].reverse();
  assert.deepEqual(orderStorefrontCategories(reversed).map(c => c.nameAr), [...names, 'أخرى']);
  assert.deepEqual(reversed.map(c => c.nameAr), [...categories].reverse().map(c => c.nameAr), 'input is not mutated');
  assert.deepEqual(names.map(name => categoryPresentationKey('any', name)), [...STOREFRONT_CATEGORY_ORDER]);
});

test('new categories appear alphabetically before Other; seeded codes still work', () => {
  assert.deepEqual(orderStorefrontCategories([
    {code: 'x', nameAr: 'أخرى'}, {code: 'y', nameAr: 'زينة'},
    {code: 'CAT-BEV', nameAr: 'اسم قديم للمشروبات'}, {code: 'z', nameAr: 'ألبان'},
  ]).map(c => c.nameAr), ['اسم قديم للمشروبات', 'ألبان', 'زينة', 'أخرى']);
});

test('custom premium/biscuit designs are distinct, stable after RESET and default is grey', () => {
  const premium = getCategoryVisual('CUTOVER-1', 'شوكلاتة غوالي');
  assert.deepEqual(premium, getCategoryVisual('CUTOVER-91', 'شوكلاتة غوالي'));
  assert.notEqual(premium.active, getCategoryVisual('CAT-CHOCO').active);
  const biscuit = getCategoryVisual('CUTOVER-2', 'بسكويت 10 قروش');
  assert.notEqual(biscuit.active, getCategoryVisual('CAT-BISCUIT').active);
  assert.notEqual(biscuit.icon, getCategoryVisual('CAT-BISCUIT').icon);
  const other = getCategoryVisual('CUTOVER-3', 'أخرى');
  assert.equal(other.active, 'from-slate-500 to-slate-400');
  assert.deepEqual(other, getCategoryVisual('NEW', 'قسم جديد'));
  for (const name of [...names, 'أخرى', 'قسم جديد']) {
    const visual = getCategoryVisual('CUTOVER', name);
    assert.ok(visual.accent && visual.active && visual.glow);
    assert.ok(visual.icon);
  }
});
