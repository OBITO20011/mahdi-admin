import{sourceBeforeRecordOrder}from'../scripts/audit/source-before-record-order.mjs';
import{sourceBeforeProductWorkbook}from'../scripts/audit/source-before-product-workbook.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const read = (file: string) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const guideFile = 'docs/operations/RESET219_REFERENCE_D1_AR.md';
const guide = read(guideFile);
const sha = 'A915B64DE94BCA2FB8A2FC3942113B7A64379CC1E8746375FAE9297DB7A26333';
const source = 'C:\\Users\\TOP\\NawasrahFrankfurt\\go-live-rehearsal219-local-20261102\\adapter-ready\\local-reference-through219-ready.json';
const target = 'C:\\Users\\TOP\\NawasrahFrankfurt\\nawasrah-fra-001-138\\local-reference-through219-ready.json';
const blocks = [...guide.matchAll(/```powershell\n([\s\S]*?)```/gu)].map(match => match[1]);

test('D-1 names the delivered exact source, target and hash; old owner reference is not a valid input', () => {
  assert.equal(blocks.length, 2);
  assert.ok(guide.includes(source));
  assert.ok(guide.includes(target));
  assert.ok(guide.includes(sha));
  assert.ok(guide.includes('56E3C5574C5ED17D7FAE156091F870864822865B16C2B0F2199A5292C33ABA6A'));
  assert.ok(blocks[0].includes(`$referenceSource = '${source}'`));
  assert.ok(blocks[0].includes(`$referenceTarget = '${target}'`));
  assert.ok(blocks[0].includes(`$referenceExpectedSha = '${sha}'`));
  assert.ok(!blocks[0].includes('56E3C557'));
  for (const marker of ['تقرير التسليم', 'تقرير تسليم #59', 'reset219-identities.json', 'بلا اتصال', 'لم يستبدل Codex ملف المالك']) {
    assert.ok(guide.includes(marker), marker);
  }
});

test('copy instructions fail closed and preserve a verified previous file before replacing only the expected reference', () => {
  const code = blocks[0];
  const ordered = [
    '$ErrorActionPreference', "'RESET219_IN_PROGRESS.json'", 'SOURCE219_REFERENCE_HASH_MISMATCH',
    '$referenceBeforeSha =', '$referenceBackup = $referenceTarget',
    'Copy-Item -LiteralPath $referenceTarget -Destination $referenceBackup', 'PREVIOUS219_REFERENCE_BACKUP_HASH_MISMATCH',
    'Copy-Item -LiteralPath $referenceSource -Destination $referenceIncoming', 'COPIED219_REFERENCE_HASH_MISMATCH',
    'Move-Item -LiteralPath $referenceIncoming -Destination $referenceTarget', 'TARGET219_REFERENCE_HASH_MISMATCH',
    'beforeSha256=$referenceBeforeSha', 'afterSha256=$referenceAfterSha',
  ];
  let at = -1;
  for (const marker of ordered) {
    const next = code.indexOf(marker);
    assert.ok(next > at, marker);
    at = next;
  }
  assert.ok(code.includes('if ($referenceBeforeSha -ne $referenceExpectedSha)'));
  assert.ok(code.includes("'.before-D1-'"));
  assert.ok(code.includes('[guid]::NewGuid()'));
  assert.ok(code.includes('(Get-FileHash -Algorithm SHA256 -LiteralPath $referenceTarget).Hash'));
  assert.doesNotMatch(code, /Remove-Item|Invoke-WebRequest|Invoke-RestMethod|--apply|--dry-run|--resume|--linked|PGPASSWORD|https?:\/\//u);
});

test('local readiness remains the real current guard, and the plan/card require installation before rehearsal', () => {
  assert.ok(blocks[1].includes("from './scripts/operations/frankfurt-reference219.mjs'"));
  assert.ok(blocks[1].includes('await readReady219Reference(process.cwd(), process.argv[1])'));
  assert.ok(blocks[1].includes('if ($LASTEXITCODE -ne 0)'));
  assert.ok(blocks[1].includes('RESET219_REFERENCE_NOT_READY_FOR_CURRENT_MAIN_STOP'));
  assert.ok(guide.includes('لا تنفّذها أثناء محاولة تصفير قائمة'));
  assert.ok(guide.includes('الاستئناف يحتفظ بمرجعه ولقطته الأصليين'));
  const plan = read('docs/operations/GO_LIVE_CUTOVER_AR.md');
  assert.ok(plan.indexOf('| 1.4أ مرجع RESET219') < plan.indexOf('| 1.5أ بروفة متصلة'));
  assert.ok(plan.includes('(RESET219_REFERENCE_D1_AR.md)'));
  for (const suffix of ['md', 'html']) {
    const card = read('docs/handover/ورقة-يوم-التشغيل.' + suffix);
    for (const marker of ['D-1', 'المالك يستبدل مرجع workdir بالصالح', 'بصمة قبل/بعد وفحص الجاهزية', 'RESET219_REFERENCE_D1_AR.md']) assert.ok(card.includes(marker), marker);
  }
});

test('exact historical inverse updates only reviewed doc hashes and branch metadata, retaining all original bytes', () => {
  const baseline = '85c80df17a5e74cb92163d88cf38d52184758935';
  const git = (file: string) => JSON.parse(execFileSync('git', ['show', baseline + ':' + file], { encoding: 'utf8', maxBuffer: 32 * 1024 ** 2 }));
  const legacyFile = 'scripts/testing/rehearsal219-legacy-view.json';
  const legacy = JSON.parse(read(legacyFile));
  const oldLegacy = git(legacyFile);
  const state = 'docs/agent/project-state.json';
  assert.equal(legacy.files[state].after, createHash('sha256').update(sourceBeforeRecordOrder(state,read(state))!).digest('hex'));
  legacy.files[state].after = oldLegacy.files[state].after;
  assert.deepEqual(legacy, oldLegacy);
  const pinFile = 'scripts/audit/home-performance219-source-pins.json';
  const pins = JSON.parse(read(pinFile));
  const oldPins = git(pinFile);
  for (const file of ['docs/operations/GO_LIVE_CUTOVER_AR.md', 'docs/handover/ورقة-يوم-التشغيل.md', 'docs/handover/ورقة-يوم-التشغيل.html', 'tests/handover-documentation.test.ts']) {
    assert.equal(pins.entries[file].after, createHash('sha256').update(sourceBeforeProductWorkbook(file,read(file))!).digest('hex'));
    pins.entries[file].after = oldPins.entries[file].after;
  }
  assert.deepEqual(pins, oldPins);
});
