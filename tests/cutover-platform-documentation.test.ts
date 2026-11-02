import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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
  ordered(card, ['7. RESET219: dry-run', '8. «افحص»', '8أ. Auth', '8ب. Edge Secrets', '16. كلمة المالك «انشر»', '17. فتح الطلبات']);
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
  for (const text of [plan, card, print]) {
    for (const marker of ['بروفة متصلة ناجحة', 'أحدث أرشيف', 'بنفس رأس الأداة', 'بروفة-يوم-التشغيل.md', '7–12 ساعة',
      'تفريغ Storage ثم إسقاط public', 'شغّالاً ليلاً', 'R2', 'الخطة المجانية']) assert.ok(text.includes(marker), marker);
    assert.ok(text.includes('RESET219'));
  }
  assert.ok(plan.includes('ليست إذناً لدمجه'));
  assert.ok(plan.includes('PR #59'));
  assert.ok(plan.includes('أعد البروفة إذا تغيّرت الأداة'));
  assert.ok(plan.includes('R2 لا ينشئ نسخة إن كان الجهاز مطفأً'));
  assert.ok(plan.includes('حفظ لقطة الاحتفاظ والتحقق منها'));
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
    assert.equal(now.entries[path].after, createHash('sha256').update(read(path)).digest('hex'));
  }
  for (const [path, pin] of Object.entries(old.entries) as [string, { before: string; beforeText: string }][] ) {
    assert.equal(now.entries[path].before, pin.before, path);
    assert.equal(now.entries[path].beforeText, pin.beforeText, path);
  }
  assert.equal(now.baseline, old.baseline);
});
