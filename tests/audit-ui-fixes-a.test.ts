import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ammanDateInput,ammanDateTimeInput,ammanDateTimeInputToIso} from '../src/utils/ammanTime';
import {allowsOperatingDestination,operatingNavigation} from '../src/features/operatingMode/navigationPolicy';
import {ADMIN_NAVIGATION_GROUPS} from '../src/features/more/adminNavigation.config';
import {STORE_PUBLIC_CONFIG} from '../customer-web/src/config/store';

const source=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8').replaceAll('\r\n','\n');

test('audit 2: receipt time defaults and round-trips as Amman wall clock', () => {
  // 11:00Z is 14:00 in Amman; the old default showed 11:00 and saved an edited 14:00 as 17:00 Amman.
  const instant=new Date('2026-11-25T11:00:00Z');
  assert.equal(ammanDateTimeInput(instant),'2026-11-25T14:00');
  assert.equal(ammanDateTimeInputToIso('2026-11-25T14:00'),'2026-11-25T11:00:00.000Z');
  assert.equal(ammanDateTimeInputToIso('2026-11-25T14:00:00'),'2026-11-25T11:00:00.000Z');
  // 22:30Z is 01:30 the next day in Amman; the date default is Amman's day, not UTC's.
  const lateNight=new Date('2026-11-25T22:30:00Z');
  assert.equal(ammanDateInput(lateNight),'2026-11-26');
  assert.equal(ammanDateTimeInput(lateNight),'2026-11-26T01:30');
  assert.equal(ammanDateTimeInputToIso('2026-11-26T01:30'),'2026-11-25T22:30:00.000Z');
  for(const bad of ['','2026-13-01T10:00','2026-02-30T10:00','2026-11-25 14:00','14:00'])assert.equal(ammanDateTimeInputToIso(bad),undefined,bad);
  const modal=source('src/features/directReceiving/CreateDirectReceiptModal.tsx');
  assert.match(modal,/useState<string>\(\n\s*\(\) => ammanDateTimeInput\(\)\n\s*\);/u);
  assert.match(modal,/receivedAt: receivedAtIso,/u);
  assert.doesNotMatch(modal,/toISOString\(\)\.(slice|split)/u);
  assert.doesNotMatch(source('src/features/purchases/SupplierPaymentModal.tsx'),/new Date\(\)\.toISOString\(\)\.split/u);
});

test('audit 1: store WhatsApp fallback is the shop number, never the trial number', () => {
  assert.equal(STORE_PUBLIC_CONFIG.WHATSAPP_NUMBER,'0785857700');
  for(const file of ['customer-web/src/config/store.ts'])
    assert.doesNotMatch(source(file),/0772838886/u,file);
});

test('owner decision: the AI assistant is hidden in every operating mode', () => {
  for(const mode of ['full','sales-only'] as const){
    assert.equal(allowsOperatingDestination('tab','assistant',mode),false);
    assert.ok(!operatingNavigation(ADMIN_NAVIGATION_GROUPS,mode,true).some(g=>g.items.some(i=>i.id==='admin-assistant')));
    assert.equal(allowsOperatingDestination('tab','reports',mode),true);
  }
  assert.match(source('src/components/common/Header.tsx'),/canUseAssistant = operatingMode==='full'&&allowsOperatingDestination\('tab','assistant',operatingMode\)/u);
});

test('audit copy: screens use general Arabic', () => {
  const files=['src/features/more/OffParcelFeatureControl.tsx','src/features/operatingMode/Inventory224View.tsx',
    'src/features/operatingMode/OptionalQuantityPanel.tsx','src/features/more/ProfileModal.tsx','src/features/purchases/PurchaseOrderDetailView.tsx'];
  for(const file of files)assert.doesNotMatch(source(file),/ما بيشوفوا|هاد السعر|بدي أ|خلّي وحدة|واختار «|للطرد بس|إذا صارت أقل|هل أنت تأكد/u,file);
  assert.doesNotMatch(source('src/features/products/ProductFormModal.tsx'),/ما بيشوفوا|هاد السعر|بدي أ|إذا صارت أقل|هل أنت تأكد/u);
  assert.match(source('src/features/products/ProductFormModal.tsx'),/'هذا السعر سعر '\+\(openedUnitName\|\|'باكيت'\)\+'، وأريد إضافة طرد'/u);
});
