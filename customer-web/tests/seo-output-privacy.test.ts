import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';

const moduleUrl = new URL('../scripts/seo-output-privacy.mjs', import.meta.url).href;
function check(samples: string[]): boolean[] {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `import {hasPrivateSeoFields} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(${JSON.stringify(samples)}.map(hasPrivateSeoFields)));`],
  {encoding: 'utf8', windowsHide: true}));
}

test('SEO privacy accepts the actual CI Vite hash collision only in compiled resource attributes', () => {
  assert.deepEqual(check([
    '<script type="module" src="/assets/index-1tmbwaCC.js"></script>',
    '<link rel="modulepreload" href="/assets/index-1tmbwaCC.js">',
    "<link rel='stylesheet' href='/assets/index-1tmbwaCC.css'>",
  ]), [false, false, false]);
});

test('SEO privacy still refuses every private field in JSON-LD, metadata, visible content and inline code', () => {
  for (const field of ['wac', 'supplier', 'reservedQuantity', 'availableQuantity']) {
    assert.deepEqual(check([
      `<script type="application/ld+json">{"${field}":1}</script>`,
      `<meta name="description" content="${field}">`,
      `<p>${field}</p>`,
      `<script src="/assets/index-1tmbwaCC.js">${field}=1</script>`,
    ]), [true, true, true, true]);
  }
});

test('SEO privacy does not exempt resource queries, non-hashed paths, anchors or other attributes', () => {
  assert.deepEqual(check([
    '<script src="/assets/index-1tmbwaCC.js?supplier=1"></script>',
    '<script src="/assets/wac.js"></script>',
    '<a href="/assets/index-1tmbwaCC.js">منتج</a>',
    '<script src="/assets/index-1tmbwaCC.js" data-supplier="1"></script>',
  ]), [true, true, true, true]);
});
