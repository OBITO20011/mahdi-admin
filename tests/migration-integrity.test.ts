import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';

const directory = new URL('../supabase/migrations/', import.meta.url);
const names = readdirSync(directory).filter(name => /^\d{3}_.*\.sql$/u.test(name)).sort();
const state = JSON.parse(readFileSync(new URL('../docs/agent/project-state.json', import.meta.url), 'utf8'));
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
  ['128_phase5_operational_payment_and_shift_refund_fixes.sql', 'F0F2648E6513BA9820C27B3D56B7222E3783378D07EA3189FC2616E32DE6F39D'],
  ['129_phase5_block_paid_order_receipt_reversal.sql', '886AF35898E5AE73DF9427308CA322246330DDFB167814F44127D1E6C9CDB28E'],
  ['130_phase5_review_followup_shift_refund_guards.sql', '46B830DBE2712F7E396DBA23C1971E33AB097DEC9E8BE95500B1074708CE496F'],
  ['131_phase6_operational_report_readers.sql', '790219C523ECE5EF8F1853F45A0D5775C42509575E5F4E500D06A6DF506F63A1'],
] as const;

test('128-131 immutable bytes and continuity references agree with the approved fingerprints', () => {
  for (const [name, expected] of fingerprints) {
    const content = canonical(readFileSync(new URL(name, directory)));
    const actual = createHash('sha256').update(content).digest('hex').toUpperCase();
    assert.equal(actual, expected, name);
    assert.equal(state[`migration${name.slice(0, 3)}CanonicalLfSha256`], expected, name);
    const windows = canonical(Buffer.from(content.toString().replaceAll('\n', '\r\n')));
    assert.equal(createHash('sha256').update(windows).digest('hex').toUpperCase(), expected, name);
    assert.notEqual(createHash('sha256').update(Buffer.concat([content, Buffer.from('-- mutation\n')])).digest('hex').toUpperCase(), expected, name);
  }
});
