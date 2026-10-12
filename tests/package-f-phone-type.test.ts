import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('phone functional typography floor is screen-only below desktop without touching tokens',()=>{
  const css=readFileSync('src/components/ui/phone-type.css','utf8');
  assert.match(readFileSync('src/index.css','utf8'),/@import "\.\/components\/ui\/phone-type\.css"/u);
  assert.match(css,/@media screen and \(max-width: 1023px\)/u);
  for(const size of [8,9,10,11])assert.ok(css.includes(`.text-\\[${size}px\\]`));
  assert.match(css,/font-size: 12px/u);
  assert.match(css,/font-size: max\(12px, 0\.55em\)/u);
  assert.match(css,/\.recharts-text/u);
  assert.doesNotMatch(css,/color:|background:|display:|visibility:|pointer-events:|--nw-/u);
  assert.match(css,/:not\(\.sm\\:text-sm\)/u);
  assert.match(css,/@media screen and \(max-width: 639px\)/u);
});
