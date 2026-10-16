import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';

const directory = new URL('../supabase/migrations/', import.meta.url);
const names = readdirSync(directory).filter(name => /^\d{3}_.*\.sql$/u.test(name)).sort();
const state = JSON.parse(readFileSync(new URL('../docs/agent/project-state.json', import.meta.url), 'utf8'));
const hasPatchMarker = (line: string) => /^(?:\+|@@|<{7}|={7}|>{7}|\|{7})/u.test(line);

test('SQL migrations contain no patch or Git conflict markers', () => {
  for (const name of readdirSync(directory).filter(file => file.endsWith('.sql'))) {
    const lines = readFileSync(new URL(name, directory), 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => assert.equal(hasPatchMarker(line), false, `${name}:${index + 1}`));
  }
  for (const line of ['+CREATE FUNCTION', '@@ -1,2 +1,2 @@', '<<<<<<< HEAD', '=======', '>>>>>>> branch', '||||||| base']) {
    assert.equal(hasPatchMarker(line), true, line);
  }
  for (const line of ['CREATE FUNCTION', '-- SQL comment', '  + amount', 'SELECT 1;']) {
    assert.equal(hasPatchMarker(line), false, line);
  }
});
type Entry = {name: string; content: Uint8Array};
const canonical = (content: Uint8Array) => Buffer.from(
  Buffer.from(content).toString('utf8').replaceAll('\r\n', '\n'), 'utf8',
);
const digest = (entries: readonly Entry[]) => {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    hash.update(entry.name).update(Buffer.from([0])).update(canonical(entry.content));
  }
  return hash.digest('hex').toUpperCase();
};

test('migration fingerprints remain LF/CRLF portable, ordered and content/filename sensitive', () => {
  const lf = [
    {name: '001_example.sql', content: Buffer.from('BEGIN;\nSELECT 1;\nCOMMIT;\n')},
    {name: '002_example.sql', content: Buffer.from('BEGIN;\nSELECT 2;\nCOMMIT;\n')},
  ];
  const crlf = lf.map(entry => ({...entry, content: Buffer.from(entry.content.toString().replaceAll('\n', '\r\n'))}));
  assert.equal(digest(lf), digest(crlf));
  assert.equal(digest(lf), digest([...crlf].reverse()));
  assert.notEqual(digest(lf), digest([lf[0], {...lf[1], content: Buffer.from('BEGIN;\nSELECT 3;\nCOMMIT;\n')} ]));
  assert.notEqual(digest(lf), digest([lf[0], {...lf[1], name: '003_example.sql'}]));
  const unit120 = {name: '120_test.sql', content: Buffer.from('BEGIN;\nSELECT 120;\nCOMMIT;\n')};
  assert.equal(digest([unit120]), digest([{...unit120, content: Buffer.from('BEGIN;\r\nSELECT 120;\r\nCOMMIT;\r\n')} ]));
  assert.notEqual(digest([unit120]), digest([{...unit120, content: Buffer.from('BEGIN;\nSELECT 121;\nCOMMIT;\n')} ]));
  assert.notEqual(digest([unit120]), digest([{...unit120, name: '121_test.sql'}]));
});

test('approved historical 001-119 and Migration120 fingerprints stay independently pinned', () => {
  const historical = names.filter(name => Number(name.slice(0, 3)) >= 1 && Number(name.slice(0, 3)) <= 119);
  assert.equal(historical.length, 119);
  assert.equal(digest(historical.map(name => ({name, content: readFileSync(new URL(name, directory))}))),
    '294CD072D0C9AAD456901504BA3EF044CF538DA6ECA14AC68E8EC2F08FCCF7F8');
  const name = '120_phase4_returns_refunds_foundation.sql';
  assert.equal(digest([{name, content: readFileSync(new URL(name, directory))}]),
    '58C5E40E8E65D67440ACFFD6D6F11616CC3CD3C9434FD59CD5C980395B70F7FA');
});

// Approved constants, not hashes learned from the runtime bytes being tested.
const fingerprints = [
  ['121_phase42_atomic_return_coordinator.sql', '9779212034A901DBB971A68EC485D16B0AA4BE329478B9DAF1A4263CE6989BDD'],
  ['122_phase43_admin_aftercare_integration.sql', 'DF991DE73F32931B81C9C4B9C2F611F44731E99044ACBC2F5F60F4FE1192C066'],
  ['123_phase5_private_financial_evidence_foundation.sql', '3F5FE7554B17BBC6BE872175682C36D7F17B5F2B72F00BD32EAE0F6A97483E80'],
  ['124_phase5_canonical_collection_reversal_writers.sql', '4B6A50442DDF0DBEE24233CB9036469B428CE20991E0315EB6C1FAFE4BDD4F41'],
  ['125_phase5_collection_lock_lint_correction.sql', 'D1CDA688B835C2791A0890F4E000A85FA7309B1A4E4DE02F21819491330A546B'],
  ['126_phase5_private_tender_coordinator.sql', '4C099804BA1D6B97DF6AF3FA0C0A8D514FD616397BDE1BC7F5E5DAE3EB8B1D21'],
  ['127_phase5_private_financial_read_model.sql', 'A2C9561EF071E959152D7DD06CAFC0F9BE933F18F845F4AE03D2B1A8971BE60D'],
  ['128_phase5_operational_payment_and_shift_refund_fixes.sql', 'F0F2648E6513BA9820C27B3D56B7222E3783378D07EA3189FC2616E32DE6F39D'],
  ['129_phase5_block_paid_order_receipt_reversal.sql', '886AF35898E5AE73DF9427308CA322246330DDFB167814F44127D1E6C9CDB28E'],
  ['130_phase5_review_followup_shift_refund_guards.sql', '46B830DBE2712F7E396DBA23C1971E33AB097DEC9E8BE95500B1074708CE496F'],
  ['131_phase6_operational_report_readers.sql', '790219C523ECE5EF8F1853F45A0D5775C42509575E5F4E500D06A6DF506F63A1'],
  ['132_package_d_system_unification.sql', '775274E9D8F34F98EBC408BBDE883EF909C64BC751107A43DC7D486F8499526B'],
  ['133_package_e_supplier_po_financial_consistency.sql', '073787127AA6FA05448A43E20A97042969A185DAC3FA1ABED53EC12A874E16E4'],
  ['134_package_e_read_performance.sql', 'DE3A0F6FA2A52CC595A06F912FBB199470327E27459365A7FD0D49DBF536D3DD'],
  ['135_package_f_pos_customer_inventory_reads.sql', '2F699CAC9EB167C1A44838EE9CF72894C0F7D47846125F698C211E2592EE3B52'],
  ['136_package_f_customer_debt_aging.sql', 'B324874E401CCDE88084314841F9F75DC64562C40ECBFB780B177F531FC40E24'],
  ['137_package_f_crm_financial_filters.sql', '4FEE1C389F81D204BD6E781A968D0C7388D398847C6EADCB1B40253C1A609794'],
  ['138_package_f_customer_statement.sql', 'AB01B7A1E2FFDB57404DF92A6EB637F6CA0278EAEFD9C02B685D27FABE6AD6B3'],
  ['139_project_order_push_webhook_url.sql', 'C193211C782E4375092EB93AA74655F67F3429832010B7E0036E1DB18847F262'],
  ['150_explicit_application_table_read_privileges.sql', '747E19115C0CCD5FF050159555D429DE5933078CB5F94E63C8DF2B6656A4C5B0'],
  ['151_explicit_application_realtime_publication.sql', 'FD7F12E6FF97FEC97E35FD04BA43B6954CD2A841ACCD8C2BEBD6186DB6823F62'],
  ['160_go_live_setup_foundation.sql', 'A0A0A33D51BBBBA08FCE4CE9C87DA194149C4683A640D64B4DAAF16404D864BB'],
  ['161_go_live_customer_opening_balances.sql', '3456BE3C07331BEBA1538A6F693DBE566696433A98A0A371BF2C82774FA619A6'],
  ['162_go_live_supplier_opening_balances.sql', 'E9B76071095C5371EB537F40ABC44D9091BAC6A80A72DDBE92D559F1CDA9957B'],
  ['163_go_live_unified_collection_and_supplier_opening_payment.sql', 'B3A51F8F9DFF65C533C864352B49D85786C0E0591402A7053682165785994345'],
  ['164_go_live_receivables_in_reports.sql', '6A3D49D4C0B1E95FD128D2A817F3D3F744EA624C597E6055DD0BA8927D5A0E03'],
  ['170_product_edit_optimistic_concurrency.sql', '78CAAEA4E7474D9C106A93B211C1C0AB9ECF3F836C834F21C25D02ED74069C73'],
  ['171_product_cost_preserved_on_edit.sql', 'CBDA4E226DE0752DF522A23C2B6990CCD984D69D8D1A4E34F11AE10AF1618781'],
  ['180_owner_cash_withdrawals.sql', '080A6F155A3D6CBAC1799E438E4698E899EB7D58258C0904D030CC56D752B9E1'],
  ['181_owner_withdrawal_readers.sql', 'E3448DD3161618FB3B6574944B84D56260B5EEAAE214688135926BD29CE477F6'],
  ['182_owner_withdrawal_monitoring.sql', 'B8E7DB1AF4EF9111AA7C0476D0C6373A38DF37BC168C018261A69B22637BB70E'],
] as const;

test('121-150 delivered bytes and continuity references agree with fixed approved fingerprints', () => {
  for (const [name, expected] of fingerprints) {
    const content = canonical(readFileSync(new URL(name, directory)));
    const actual = createHash('sha256').update(content).digest('hex').toUpperCase();
    assert.equal(actual, expected, name);
    const number = name.slice(0, 3);
    const reference = number === '121' || number === '123'
      ? state[`migration${number}Sha256`] : state[`migration${number}CanonicalLfSha256`];
    assert.equal(reference, expected, name);
    const windows = canonical(Buffer.from(content.toString().replaceAll('\n', '\r\n')));
    assert.equal(createHash('sha256').update(windows).digest('hex').toUpperCase(), expected, name);
    assert.notEqual(createHash('sha256').update(Buffer.concat([content, Buffer.from('-- mutation\n')])).digest('hex').toUpperCase(), expected, name);
  }
});

test('migration numbers are unique and contiguous from001 to the approved ceiling', () => {
  const numbers = names.map(name => Number(name.slice(0, 3)));
  assert.equal(new Set(numbers).size, numbers.length, 'duplicate migration number');
  // Owner2026-10-15:140-149 are permanently UNUSED,not a parallel lane.
  const unused = Array.from({length:10}, (_, index) => index + 140);
  assert.deepEqual(state.unusedMigrationNumbers,unused);
  assert.deepEqual(state.reservedMigrationNumbers,Array.from({length:10},(_,i)=>160+i));
  assert.deepEqual(state.codexMigrationNumbers,Array.from({length:8},(_,i)=>152+i));
  assert.ok(!numbers.some(n=>unused.includes(n)),'retired140-149 must remain empty');
  assert.deepEqual(numbers, Array.from({length: state.migrationCeiling}, (_, index) => index + 1)
    .filter(n => !unused.includes(n)&&!state.deferredMigrationNumbers.includes(n)));
  assert.deepEqual(state.deferredMigrationNumbers,[...Array.from({length:8},(_,i)=>152+i),165,166,167,168,169,...Array.from({length:8},(_,i)=>172+i)]);
  assert.deepEqual(state.cloudMigrationNumbers,Array.from({length:10},(_,i)=>170+i));
  assert.deepEqual(state.nextCloudMigrationNumbers,Array.from({length:10},(_,i)=>180+i));
});
