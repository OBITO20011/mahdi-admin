import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {StoreHero} from '../src/components/StoreHero';

const render=(availablePackages:number|null)=>renderToStaticMarkup(React.createElement(StoreHero,{availablePackages,productsCount:1092,categoriesCount:15,onBrowseProducts:()=>{},announcementText:'عرض تجريبي'}));
test('OFF hero describes catalog and manual availability without asserting tracked stock',()=>{
  const html=render(null);
  assert.match(html,/تشكيلة الجملة بين يديك/u);assert.match(html,/يحدد المحل توفر الأصناف/u);
  assert.doesNotMatch(html,/من المخزون مباشرة|عدد الطرود المتاحة|طرد متاح/u);
});
test('ON hero retains the current stock headline and description, including zero stock',()=>{
  for(const count of [0,12]){const html=render(count);assert.match(html,/من المخزون مباشرة/u);assert.match(html,/اختر الطرود المتوفرة فعليًا لدى النواصرة/u);assert.match(html,/وعدد الطرود المتاحة تأتي من نظام الإدارة نفسه/u);assert.match(html,/طرد متاح/u);assert.doesNotMatch(html,/تشكيلة الجملة بين يديك/u);}
});
