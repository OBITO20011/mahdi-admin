import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {allowsHeroVideo, requestHeroVideoAfterLoad} from '../src/utils/heroMedia';

test('decorative video refuses reduced motion, data saving and every slow connection', () => {
  assert.equal(allowsHeroVideo(false), true); // Safari without Network Information API.
  assert.equal(allowsHeroVideo(false, {effectiveType: '4g'}), true);
  assert.equal(allowsHeroVideo(true, {effectiveType: '4g'}), false);
  assert.equal(allowsHeroVideo(false, {saveData: true}), false);
  for (const effectiveType of ['slow-2g', '2g', '3g']) {
    assert.equal(allowsHeroVideo(false, {effectiveType}), false);
  }
});

test('the exact approved high-priority LCP poster remains and no gesture gates playback', () => {
  const file = 'customer-web/src/components/StoreHero.tsx';
  const source = readFileSync(new URL('../src/components/StoreHero.tsx', import.meta.url), 'utf8');
  const before = execFileSync('git', ['show', '996b4fe07e148e3d748cfc6234b0a0015e85cfe3:' + file], {encoding: 'utf8', windowsHide: true});
  const poster = /<img src="\/nawasrah-hero-poster\.webp"[^>]+\/>/u;
  assert.equal(source.match(poster)?.[0], before.match(poster)?.[0]);
  assert.match(source.match(poster)![0], /fetchPriority="high"/u);
  assert.doesNotMatch(source, /pointerdown|keydown/u);
});

for (const complete of [false, true]) test(`video waits for load plus exactly one second; complete=${complete}`, t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const descriptors = ['window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const listeners = new Set<() => void>();
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {
    addEventListener: (name: string, fn: () => void) => { assert.equal(name, 'load'); listeners.add(fn); },
    removeEventListener: (name: string, fn: () => void) => { assert.equal(name, 'load'); listeners.delete(fn); },
  }});
  Object.defineProperty(globalThis, 'document', {configurable: true, value: {readyState: complete ? 'complete' : 'loading'}});
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  let requests = 0;
  const cancel = requestHeroVideoAfterLoad(() => requests++);
  if (!complete) { t.mock.timers.tick(5000); assert.equal(requests, 0); for (const load of listeners) load(); }
  t.mock.timers.tick(999); assert.equal(requests, 0);
  t.mock.timers.tick(1); assert.equal(requests, 1);
  cancel();
  const cancelPending = requestHeroVideoAfterLoad(() => requests++);
  cancelPending();
  for (const load of listeners) load();
  t.mock.timers.tick(5000); assert.equal(requests, 1);
});
