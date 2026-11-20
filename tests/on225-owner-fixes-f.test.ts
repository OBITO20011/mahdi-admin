import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DashboardHome} from '../src/features/dashboard/DashboardHome.tsx';
import {homeFixture,shiftFixture} from '../e2e/package-f-home.fixture.ts';

// Owner UX batch F (2026-11-20): the owner approved all eight simplification items.
const raw=(file:string)=>readFileSync(file,'utf8');

test('Home keeps four numbers, the shift and the alerts; extras sit in one closed fold',()=>{
  const html=renderToStaticMarkup(React.createElement(DashboardHome,{data:homeFixture,currentUserName:'مهدي',currentShift:shiftFixture,loading:false,error:null,realtimeConnected:false,
    onRefresh(){},onOrders(){},onAccounts(){},onInventory(){},onProducts(){},onShift(){},onSell(){},onReceive(){},onExpense(){}}));
  for(const label of ['ربح الشهر','المقبوض اليوم','الديون على الزبائن','طلبات تحتاج إجراء','تنبيه مخزون','أرقام إضافية'])assert.ok(html.includes(label),label);
  for(const gone of ['إجراءات سريعة','تفاصيل إضافية','عدد العملاء المتأخرين','الجاهزية محسوبة حسب طرد البيع','data-testid="supplier-replacement-summary"'])assert.ok(!html.includes(gone),gone);
  assert.match(html,/<details data-testid="home-more"[^>]*><summary[^>]*>أرقام إضافية<\/summary>/u);
  const fold=html.slice(html.indexOf('data-testid="home-more"'));
  assert.ok(fold.includes('صافي المبيعات — آخر 7 أيام'));
});

test('POS cart: one customer list first, search on demand, no helper sentences or repeated unit badge',()=>{
  const pos=raw('src/features/pos/PosView.tsx');
  const picker=pos.slice(pos.indexOf('data-testid="pos-customer-picker"'),pos.indexOf('{cartItems.length === 0 ?'));
  assert.ok(picker.indexOf('aria-label="اختيار العميل"')<picker.indexOf('aria-label="البحث عن عميل للبيع"'));
  assert.match(picker,/\{isCustomerSearchOpen && <div/u);
  assert.match(pos,/useState\(false\);\n/u);
  for(const gone of ['للبيع النقدي العابر','ستُحفظ الفاتورة في سجل','عميل مطابق','صفر يعني','سلة المبيعات الحالية'])assert.ok(!pos.includes(gone),gone);
  assert.match(pos,/title=\{'السلة \(' \+ cartItems\.length \+ '\)'\}/u);
  assert.doesNotMatch(pos,/<StatusBadge tone=\{item\.v2Line\.commercial_line_kind/u);
  assert.match(picker,/البيع بالدين يحتاج اختيار زبون\./u);
});

test('order detail shows each fact once and puts the next step before the items',()=>{
  const detail=raw('src/features/orders/OrderDetailModal.tsx');
  const next=detail.indexOf('الخطوة التالية'),summary=detail.indexOf('{embedded && <OrderCommercialSummary order={order} />}');
  assert.ok(next>0&&summary>next,'commercial summary follows the next-step box');
  assert.equal(detail.split('<OrderCommercialSummary').length-1,1);
  assert.equal(detail.split('<StatusBadge tone={getOrderStatus(order.status).tone}>').length-1,1);
  for(const gone of ['كميات هذا الطلب محجوزة منذ إنشائه','هذا الطلب بلا تتبع مخزون أو حجز','الإجمالي {order.totalAmount.toFixed(3)} {CURRENCY} ·'])assert.ok(!detail.includes(gone),gone);
  assert.match(detail,/\{!embedded&&<>\n\s*<div className="space-y-2 rounded-2xl border border-nw-border bg-nw-surface-2 p-3">\n\s*<h4 className="font-bold text-nw-text">أصناف الطلب<\/h4>/u);
});

test('orders list and customer filters carry less text',()=>{
  const center=raw('src/features/orders/OrdersCenterView.tsx');
  assert.doesNotMatch(center,/راجع الطلبات وتابع التجهيز/u);
  assert.doesNotMatch(center,/فتح ومراجعة الطلب/u);
  assert.doesNotMatch(center,/بحاجة لمراجعة: \{summary\.review\}/u);
  const filters=raw('src/features/crm/CustomerFilters.tsx');
  const primary=filters.slice(filters.indexOf('PRIMARY_FILTERS:'),filters.indexOf('MORE_FILTERS:'));
  assert.equal((primary.match(/value:'/gu)??[]).length,3);
  assert.match(filters,/aria-label="فلاتر أخرى"/u);
});

test('UI copy uses general Arabic, not colloquial words',()=>{
  const words=['شو','بده','بدي','هاد','خلّيه','خلّيها','خلّي','اللي','المصاري','مصاري','الخربان','بيتباع','بتساعد','بتنحسب','عبّي','ربحك','ساعتها','لسا','ضل','إلك'];
  const re=new RegExp(String.raw`(?<![\p{L}\p{M}])(`+words.join('|')+String.raw`)(?![\p{L}\p{M}])`,'u');
  // Workbook column headers are the owner's import file format; they stay byte-identical.
  // The product form (product-workbook history), businessError.ts (pre-delivery translation parity) and the store cart.ts (ON225 display proof) are frozen, so their copy stays as is.
  const keep=new Set(['src/features/goLive/goLiveImport.ts','src/features/products/ProductFormModal.tsx','src/utils/businessError.ts','customer-web/src/utils/cart.ts']);
  const files:string[]=[];const walk=(dir:string)=>{for(const name of readdirSync(dir)){const path=join(dir,name);if(statSync(path).isDirectory())walk(path);else if(/\.tsx?$/u.test(name)&&!/\.test\./u.test(name))files.push(path.split('\\').join('/'));}};
  walk('src');walk('customer-web/src');
  const hits=files.filter(file=>!keep.has(file)).flatMap(file=>raw(file).split('\n').map((line,index)=>({file,line:index+1,text:line}))
    .filter(row=>!/^\s*(\/\/|\*|\/\*)/u.test(row.text)&&re.test(row.text)).map(row=>`${row.file}:${row.line}`));
  assert.deepEqual(hits,[]);
});

test('screen text never goes below 12px on phone, laptop or storefront',()=>{
  const admin=raw('src/components/ui/phone-type.css');
  assert.match(admin,/@media screen and \(min-width: 1024px\) \{\n {2}:is\(\.text-\\\[8px\\\], \.text-\\\[9px\\\], \.text-\\\[10px\\\], \.text-\\\[11px\\\]\):not\(\[data-side-nav-item\]\) \{\n {4}font-size: 12px;/u);
  assert.match(admin,/@media screen and \(max-width: 1023px\)/u);
  const store=raw('customer-web/src/index.css');
  assert.match(store,/@media screen \{\n {2}:is\(\.text-\\\[8px\\\], \.text-\\\[9px\\\], \.text-\\\[10px\\\], \.text-\\\[11px\\\]\) \{\n {4}font-size: 12px;/u);
});
