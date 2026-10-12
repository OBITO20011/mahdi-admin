import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
test('storefront focus guards commit synchronously and cannot remain active while inert',()=>{
  const hook=read('../src/hooks/useDialogFocus.ts');
  const utility=read('../src/utils/dialogFocus.ts');
  assert.match(hook,/useLayoutEffect\(\(\) =>/u);
  assert.doesNotMatch(hook,/\buseEffect\b/u);
  assert.match(utility,/if \(!available\(panel\)\) return/u);
  assert.match(utility,/const top = \(\) => activeDialog\(\) === panel/u);
  assert.match(utility,/\[inert\], \[aria-hidden="true"\]/u);
});
test('focus-only handover preserves new interaction and does not activate a close button on Enter',()=>{
  const utility=read('../src/utils/dialogFocus.ts');
  assert.match(utility,/available\(active\) && panel.contains\(active\)/u);
  assert.match(utility,/panel.focus\(\{preventScroll: true\}\)/u);
  assert.match(utility,/focused.closest\('\[role="dialog"\]'\)/u);
  assert.match(utility,/available\(previous\)/u);
  assert.doesNotMatch(utility,/setForm|localStorage|\.rpc\(|setTimeout|requestAnimationFrame/u);
});
