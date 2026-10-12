import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {financialUiContract} from '../scripts/testing/package-f-financial-ui-contract.mjs';

const baseline = '289f398989ca92dfdc32387d349c20a116aee515';
const files = [
  'src/features/crm/CustomerDetailView.tsx', 'src/features/crm/CustomerList.tsx',
  'src/features/crm/CrmView.tsx', 'src/features/expenses/ExpensesView.tsx',
  'src/features/users/UsersView.tsx', 'src/features/directReceiving/DirectReceivingView.tsx',
  'src/features/purchases/PurchasesView.tsx', 'src/features/more/StorefrontSettingsModal.tsx',
];
for (const file of files) test(`phone presentation exact business/event/value/confirmation parity: ${file}`, () => {
  const before = execFileSync('git', ['show', `${baseline}:${file}`], {encoding: 'utf8'});
  let after = readFileSync(file, 'utf8');
  if (file.endsWith('/CustomerDetailView.tsx')) {
    // Original five sections plus approved138 read-only section; old financial values stay pinned.
    const values = [...after.matchAll(/<MobileTabSection value="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(values, ['summary', 'statement', 'summary', 'addresses', 'orders', 'summary']);
    assert.equal([...after.matchAll(/<MobileTabSection value="statement"><CustomerStatement customerId=\{customer\.id\} revision=\{customer\} \/><\/MobileTabSection>/g)].length,1);
    after=after.replace(/<MobileTabSection value="statement"><CustomerStatement customerId=\{customer\.id\} revision=\{customer\} \/><\/MobileTabSection>/g,'');
    after = after.replace(/<MobileTabSection value="(?:summary|addresses|orders)"/g, '<MobileTabSection');
  }
  if (file.endsWith('/CrmView.tsx')) {
    // Only the authorized portrait-shell breakpoint changes, not business functions.
    assert.equal([...after.matchAll(/max-width: 1023px/g)].length, 2);
    after = after.replaceAll('max-width: 1023px', 'max-width: 767px');
  }
  assert.deepEqual(financialUiContract(file, after), financialUiContract(file, before));
});

test('phone tabs preserve mounted children/readers; no fabricated statement or financial authority', () => {
  const source = readFileSync('src/components/ui/PhonePresentation.tsx', 'utf8');
  assert.match(source, /lg:contents/);
  assert.match(source, /aria-controls=/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.doesNotMatch(source, /\.rpc\(|FromSupabase|localStorage|confirm\(|prompt\(/);
  const profile = readFileSync('src/features/crm/CustomerDetailView.tsx', 'utf8');
  assert.match(profile, /defaultValue="summary"/);
  assert.match(profile, /value:'statement',label:'كشف الحساب'/);
  assert.match(profile, /<CustomerStatement customerId=\{customer\.id\} revision=\{customer\} \/>/);
  assert.doesNotMatch(profile, /fetchCustomerStatement|\.rpc\(/);
  assert.match(profile, /data-testid="customer-fixed-header"/);
});

test('named action sheet remains44px and forwards existing children instead of new mutations', () => {
  const source = readFileSync('src/components/ui/PhonePresentation.tsx', 'utf8');
  assert.match(source, /\{children\}<\/div>/);
  assert.match(source, /useDialogFocus\(open && phone/);
  const css = readFileSync('src/components/ui/phone-presentation.css', 'utf8');
  assert.match(css, /min-height: 44px/);
  assert.match(css, /content: attr\(aria-label\)/);
});

test('phone disclosures keep native fields mounted and reveal invalid controls without bypassing validation', () => {
  const source = readFileSync('src/components/ui/PhonePresentation.tsx', 'utf8');
  assert.match(source, /visible = !phone \|\| expanded/);
  assert.match(source, /className=\{visible \? 'space-y-3' : 'hidden'\}/);
  assert.match(source, /onInvalidCapture=/);
  assert.match(source, /querySelector<HTMLElement>\(':invalid'\)/);
  const settings = readFileSync('src/features/more/StorefrontSettingsModal.tsx', 'utf8');
  assert.match(settings, /title="هوية المتجر والتواصل" defaultOpen/);
  assert.equal([...settings.matchAll(/<MobileDisclosure /g)].length, 4);
  assert.match(readFileSync('src/features/purchases/PurchasesView.tsx', 'utf8'), /approvedOrdersCount \+ partiallyReceivedCount/);
});
