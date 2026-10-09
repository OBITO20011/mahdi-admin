import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { OrdersWorkbench, OperationalOrderCard } from '../src/features/orders/OrdersCenterView';
import { getOrderStatus, getPaymentLabel, orderSourceLabel } from '../src/features/orders/orderStatus';
import { OrderDetailModal } from '../src/features/orders/OrderDetailModal';
import { FilterChips, formatUiTime } from '../src/components/ui';
import { orderListFixture, ordersFixture } from '../e2e/package-f-orders.fixture';

const center = readFileSync('src/features/orders/OrdersCenterView.tsx', 'utf8');
const detail = readFileSync('src/features/orders/OrderDetailModal.tsx', 'utf8');
test('status, source and payment presentation keep historical and uncollectible semantics', () => {
  assert.equal(getOrderStatus('preparing').tone, 'warn');
  assert.equal(getOrderStatus('returned').label, 'مرتجع');
  assert.equal(getOrderStatus('expired').tone, 'mute');
  assert.equal(getPaymentLabel({ ...orderListFixture[0], status: 'cancelled', amountDue: 999 }).label, 'لا مبلغ للتحصيل');
  assert.equal(getPaymentLabel({ ...orderListFixture[0], paymentStatus: 'partially_paid', amountDue: 12.345 }).label, 'متبقي 12.345');
  assert.equal(orderSourceLabel('pos'), 'الكاشير');
  assert.equal(orderSourceLabel('website'), 'المتجر');
  assert.equal(orderSourceLabel(), 'غير متاح'); // no inference from prefix/number
});
test('phone cards retain historical contents, selected identity, coloured border and full money', () => {
  const html = renderToStaticMarkup(React.createElement(OperationalOrderCard, { order: orderListFixture[0], onOpen: () => undefined, selected: true }));
  assert.match(html, /data-order-card="00000000-0000-4000-8000-000000000001"/);
  assert.match(html, /bg-nw-sel-row/);
  assert.match(html, /border-s-nw-info/);
  assert.match(html, /عصير برتقال 250 مل/);
  assert.match(html, /92\.200/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /[٠-٩]/);
});
test('workbench uses seven columns and only supplied authoritative chip counters', () => {
  const html = renderToStaticMarkup(React.createElement(OrdersWorkbench, { orders: orderListFixture, activeFilter: 'action', counts: { action: 1, active: 3 }, summary: { review: 1, active: 3, due: 0 }, searchQuery: '', sort: 'newest', page: 1, totalCount: 6, totalPages: 1, selectedOrderId: ordersFixture[1].id, sourceFor: () => undefined, detail: React.createElement('p', {}, 'تفاصيل'), loading: false, refreshing: false, error: null, onOpen: () => undefined, onFilter: () => undefined, onSearch: () => undefined, onSort: () => undefined, onPage: () => undefined, onRefresh: () => undefined }));
  for (const label of ['رقم الطلب', 'العميل', 'المصدر', 'الدفع', 'الحالة', 'الوقت', 'الإجمالي']) assert.ok(html.includes(label));
  assert.match(html, /aria-label="حالات الطلبات"/);
  assert.match(html, /data-testid="order-detail-panel"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /غير متاح/);
  assert.match(center, /\[activeFilter\]: result\.totalCount/);
  assert.doesNotMatch(center, /orderNumber.*startsWith|\.rpc\(/);
});
test('compact details retain immutable sale kind, parcel components and financial values', () => {
  const html = renderToStaticMarkup(React.createElement(OrderDetailModal, { order: ordersFixture[1], embedded: true, onClose: () => undefined }));
  for (const label of ['كرتونة', 'طرد مشكّل', 'باكيت', 'جبنة', 'شطة', 'ملح', '90.200', '2.000', '92.200', 'طباعة الطلب', 'إلغاء الطلب مع ذكر السبب']) assert.ok(html.includes(label), label);
  assert.match(html, /data-testid="order-commercial-summary"/);
  assert.match(html, /<details[^>]*><summary[^>]*>[\s\S]*?تفاصيل الطلب والحساب/);
  assert.doesNotMatch(html, /[٠-٩]/);
});
test('all lifecycle, contact, address, settlement and Aftercare destinations remain wired', () => {
  for (const call of ['confirmOrder(order.id)', 'advanceOrderStatus(order.id, nextStep.status)', 'cancelOrder(order.id, cancelReason.trim())', 'startOrUpdateOrderDelivery(', 'completeWebsiteOrderWithSettlement({', 'openCustomerProfile(order.customerId!)']) assert.ok(detail.includes(call), call);
  assert.match(detail, /<AdminAftercarePanel[\s\S]*onChanged=\{onOrderChanged\}[\s\S]*onContractResolved=\{handleAftercareContract\}/);
  assert.match(detail, /<EditAddressModal/);
  assert.match(detail, /<CustomerLocationCard/);
  for (const capability of ['legacy_pos_v1_unsupported', 'unsupported_contract', 'legacy_website_return_v1']) assert.ok(detail.includes(capability));
  assert.match(detail, /finally\s*\{\s*setBusy\(false\)/);
});
test('migrated order presentation and subpanels use tokens without old light override', () => {
  for (const path of ['OrdersCenterView', 'OrderDetailModal', 'OrderCommercialSummary', 'CustomerLocationCard', 'EditAddressModal', 'AdminAftercarePanel']) {
    const source = readFileSync(`src/features/orders/${path}.tsx`, 'utf8');
    assert.doesNotMatch(source, /(?:bg|text|border|from|via|to)-(?:slate|blue|gray|violet|emerald|rose|cyan|amber|indigo|green|orange|purple)-\d/, path);
  }
  assert.doesNotMatch(readFileSync('src/index.css', 'utf8'), /\[data-ui="orders-header"\]/);
});
test('touch chip opt-in preserves default dimensions and counters', () => {
  const props = { label: 'حالات', value: 'all', options: [{ value: 'all', label: 'الكل', count: 6 }], onChange: () => undefined };
  assert.match(renderToStaticMarkup(React.createElement(FilterChips, props)), /h-\[38px\]/);
  assert.match(renderToStaticMarkup(React.createElement(FilterChips, { ...props, touchSize: true })), /h-11/);
});
test('shift time is numeric first with Latin digits and correct morning/evening suffix', () => {
  assert.equal(formatUiTime('2026-10-09T05:12:00.000Z'), '08:12 ص');
  assert.equal(formatUiTime('2026-10-09T17:12:00.000Z'), '08:12 م');
  assert.match(readFileSync('src/features/dashboard/DashboardHome.tsx', 'utf8'), /<bdi dir="ltr">\{formatUiTime\(shift.startTime\)\}<\/bdi>/);
});
