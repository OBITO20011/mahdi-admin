import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sourceBeforeRehearsal219 } from '../scripts/testing/rehearsal219-legacy-view.mjs';

const read = (file: string) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const plan = read('docs/operations/GO_LIVE_CUTOVER_AR.md');
const card = read('docs/handover/ورقة-يوم-التشغيل.md');
const print = read('docs/handover/ورقة-يوم-التشغيل.html');
const baseline = '49b8d008ec56156c0e918bfed3772f33785d4b21';
const original = (file: string) => execFileSync('git', ['show', baseline + ':' + file], {
  encoding: 'utf8', maxBuffer: 32 * 1024 ** 2,
}).replaceAll('\r\n', '\n');

test('platform gates follow successful reset and precede production publishing in both documents', () => {
  const ordered = (text: string, labels: string[]) => {
    let previous = -1;
    for (const label of labels) {
      const at = text.indexOf(label);
      assert.ok(at > previous, label);
      previous = at;
    }
  };
  ordered(plan, ['| 2.5 التنفيذ', '| 2.6 افحص', '| 2.7 Auth', '| 2.8 Edge Secrets', '## 8. النشر']);
  ordered(card, ['6. RESET219: dry-run', '7. «افحص»', '8أ. Auth', '8ب. Edge Secrets', '8د. كلمة المالك «انشر»', '9. إدخال الحقيقي', '15. بعد القبول والتوقيع', '16. فتح ordersEnabled', '17. أول بيع']);
  for (const text of [plan, card, print]) {
    for (const marker of ['Auth', 'URL Configuration', 'Site URL', 'https://admin.alnawasreh.com', 'Redirect URLs',
      'TURNSTILE_TEST_MODE', 'false', 'TURNSTILE_ALLOWED_HOSTNAMES', 'alnawasreh.com', 'بعد النشر']) {
      assert.ok(text.includes(marker), marker);
    }
  }
  assert.ok(plan.includes('https://admin.alnawasreh.com/'));
  assert.ok(plan.includes('لا يوجد مسار callback مخصص'));
  assert.ok(plan.includes('طلب المتجر الواحد في §8.5'));
  assert.ok(plan.includes('لا تعِد تفعيل TEST'));
  assert.ok(plan.includes('أعد فتح الإعداد'));
});

test('D-1 requires fresh connected rehearsal at matching tool head; protection and destructive boundary are explicit', () => {
  const protectionRow = plan.split('\n').find(line => line.startsWith('| 1.2 حماية حديثة'))!;
  assert.ok(protectionRow.includes('180 migration/219'));
  assert.doesNotMatch(protectionRow, /179 migration\/217/u);
  assert.ok(plan.includes('FULL60 جودة + recovery1 + secrets1 على main دون skip'));
  for (const text of [plan, card, print]) {
    for (const marker of ['بروفة متصلة ناجحة', 'أحدث أرشيف', 'بنفس رأس الأداة', 'بروفة-يوم-التشغيل.md', '7–12 ساعة',
      'تفريغ Storage ثم إسقاط public', 'شغّالاً ليلاً', 'R2', 'الخطة المجانية']) assert.ok(text.includes(marker), marker);
    assert.ok(text.includes('RESET219'));
  }
  assert.ok(plan.includes('#59 المدمج إلى `094a071d`'));
  assert.ok(plan.includes('تغيّر أي منها يوقف القبول'));
  assert.ok(plan.includes('R2 لا ينشئ نسخة إن كان الجهاز مطفأً'));
  assert.ok(plan.includes('حفظ لقطة الاحتفاظ والتحقق منها'));
});

test('Astra critical gate freezes every writer before final backup and reruns the exact archive at the signed merge head', () => {
  const cutover = card.split('## يوم القطع —')[1];
  const sequence = ['2. بإذن يوم التشغيل', '3. حظر المعاينات وكل hash URLs فعلياً', '4. إثبات وقت آخر كتابة',
    'النسخة الفاصلة', '4أ. أثناء التجميد', 'النسخة الفاصلة نفسها', '6. RESET219: dry-run'];
  let previous = -1;
  for (const label of sequence) {
    const at = cutover.indexOf(label);
    assert.ok(at > previous, label);
    previous = at;
  }
  for (const text of [plan, card, print]) {
    for (const marker of ['SHA الدمج', 'بصمات', 'CI', '#58', 'D-1', 'وقت آخر كتابة', 'أي كتابة لاحقة تبطل النسخة',
      'النسخة الفاصلة نفسها', '10–20', '03:00', 'pg_cron', 'العلامة', 'اللقطة', 'مفتاح الأرشيف', 'لا resume إن ظهرت أعمال جديدة']) {
      assert.ok(text.includes(marker), marker);
    }
    assert.doesNotMatch(text, /RESET217/u);
  }
  assert.ok(plan.includes('نفس الرأس** يعني SHA الدمج النهائي على main'));
  assert.ok(plan.includes('لا تبديل إصدار بعد توقيع التجميد'));
  assert.ok(plan.includes('لا تستبدلها بفرض تكافؤ'));
  assert.ok(plan.includes('لا تفوض دمج #58 الآن'));
  assert.ok(plan.includes('غياب pg_cron أو اختلاف الإصدار/schema/المالك'));
  assert.ok(plan.includes('فقد العلامة أو اللقطة أو اختلافها لا يُحل بإنشائهما يدوياً'));
});

test('real phone Auth/TOTP, notifications, template totals and restored opening backup gate first sale', () => {
  for (const text of [plan, card, print]) {
    for (const marker of ['رابط Auth فعلي', 'TOTP', 'الهاتف', 'جلسات المعاينة', 'اشتراك Push بعد التصفير',
      'Telegram', 'المطوّر', 'الشيكات', 'تكلفة الوحدة', 'بداية حقيقية', 'RestoreRemote', 'آخر تشغيل ناجح لكل cron']) {
      assert.ok(text.includes(marker), marker);
    }
  }
  const acceptance = plan.split('| 8.4أ')[1].split('| 8.5 فتح الطلبات وأول بيع')[0];
  for (const marker of ['بعد نشر الإنتاج', 'قبل أول بيع', 'تسليم Telegram', 'لا بيع قبل نجاح الدخول']) assert.ok(acceptance.includes(marker), marker);
  assert.ok(plan.includes('active=true دليلاً على التنفيذ'));
  assert.ok(plan.includes('وقت البدء/النهاية والحالة'));
  assert.ok(plan.includes('مصدر مراقبة unknown لا يُسمى healthy'));
  assert.ok(plan.indexOf('| 8.4أ قبول الهاتف') < plan.indexOf('| 8.4ب إعادة بناء المتجر بعد قبول البيانات'));
  assert.ok(plan.indexOf('| 8.4ب إعادة بناء المتجر بعد قبول البيانات') < plan.indexOf('| 8.5 فتح الطلبات وأول بيع'));
  assert.ok(plan.includes('لا زر اختبارPush مستقل في الواجهة الحالية'));
  assert.ok(plan.includes('لا طلب ثانٍ'));
  assert.ok(card.includes('Turnstile وتسليم Push قبل أول بيع'));
});

test('M01 is first maintenance item; Gemini remains an owner decision; Telegram clock uses RESET219', () => {
  const maintenance = plan.split('### أول بند في خطة الصيانة بعد التسليم: M01')[1];
  assert.ok(maintenance.startsWith('\n\n1. **M01'));
  for (const marker of ['authenticated statement_timeout=8s', '32–39 ثانية', '50 ألف فاتورة', 'سيفشل بخطأ', 'لا ترفع المهلة']) {
    assert.ok(maintenance.includes(marker), marker);
  }
  for (const text of [plan, card, print]) {
    for (const marker of ['GEMINI_API_KEY', 'إخفاء التبويب أو إضافة المفتاح', 'المساعد', '00:00', 'Asia/Amman']) assert.ok(text.includes(marker), marker);
    assert.doesNotMatch(text, /بعد RESET217(?: ضبط الساعة|:00:00)/u);
  }
  assert.ok(plan.includes('قرار مالك معلّق'));
  assert.ok(plan.includes('الساعة بعد RESET219:00:00'));
  assert.ok(card.includes('بعد RESET219 ضبط الساعة'));
  assert.ok(print.includes('بعد RESET219 ضبط الساعة'));
});

test('print copy contains all text cells from Markdown and no executable or remote assets', () => {
  const decode = (s: string) => s.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&#x27;', "'");
  const plain = (s: string) => decode(s.replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim());
  const htmlText = plain(print);
  for (const line of card.split('\n')) {
    if (!line.startsWith('|') || /^\|[-| ]+\|$/u.test(line)) continue;
    for (const cell of line.split('|').slice(1, -1)) {
      const text = cell.replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1').replace(/\*\*|`/gu, '').trim();
      assert.ok(htmlText.includes(plain(text)), text);
    }
  }
  assert.equal((print.match(/<article class="print-page">/gu) ?? []).length, 2);
  assert.doesNotMatch(print, /<script|<iframe|<link\b|<img\b|url\(/iu);
});

test('documentation pins bind current copies and preserve original historical inverse bytes', () => {
  const file = 'scripts/audit/home-performance219-source-pins.json';
  const old = JSON.parse(original(file));
  const now = JSON.parse(read(file));
  const allowed = ['docs/agent/project-state.json', 'docs/operations/GO_LIVE_CUTOVER_AR.md',
    'docs/handover/ورقة-يوم-التشغيل.md', 'docs/handover/ورقة-يوم-التشغيل.html', 'tests/handover-documentation.test.ts'];
  for (const path of allowed) {
    const projected = path === 'docs/agent/project-state.json' ? sourceBeforeRehearsal219(path, read(path))! : read(path);
    assert.equal(now.entries[path].after, createHash('sha256').update(projected).digest('hex'));
  }
  for (const [path, pin] of Object.entries(old.entries) as [string, { before: string; beforeText: string }][] ) {
    assert.equal(now.entries[path].before, pin.before, path);
    assert.equal(now.entries[path].beforeText, pin.beforeText, path);
  }
  assert.equal(now.baseline, old.baseline);
  const legacyFile = 'scripts/testing/rehearsal219-legacy-view.json';
  const merged = JSON.parse(execFileSync('git', ['show', '094a071ddf305e7c6b7cf137e265ceb3a5d3a63d:' + legacyFile], {
    encoding: 'utf8', maxBuffer: 32 * 1024 ** 2,
  }));
  const legacy = JSON.parse(read(legacyFile));
  const state = 'docs/agent/project-state.json';
  assert.equal(legacy.files[state].after, createHash('sha256').update(read(state)).digest('hex'));
  legacy.files[state].after = merged.files[state].after;
  assert.deepEqual(legacy, merged, 'Only exact branch metadata after hash changes; all original bytes and guards stay');
});
