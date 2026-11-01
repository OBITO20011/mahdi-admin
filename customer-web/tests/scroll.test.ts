import test from 'node:test';
import assert from 'node:assert/strict';
import {scrollElementTo, scrollWindowTo} from '../src/utils/scroll';

test('element without scrollTo moves requested coordinates and retains omitted axis, including RTL negative positions', () => {
  const element = {scrollLeft: 20, scrollTop: 30} as HTMLElement;
  scrollElementTo(element, {left: -200, behavior: 'smooth'});assert.equal(element.scrollLeft, -200);assert.equal(element.scrollTop, 30);
  scrollElementTo(element, {top: 80});assert.equal(element.scrollLeft, -200);assert.equal(element.scrollTop, 80);
  scrollElementTo(element, {left: 0, top: 0, behavior: 'auto'});assert.equal(element.scrollLeft, 0);assert.equal(element.scrollTop, 0);
  assert.doesNotThrow(() => scrollElementTo(null, {left: 2}));
});
test('native element API receives same options and receiver, and does not use fallback', () => {
  let count = 0;const options: ScrollToOptions = {left: 123, behavior: 'smooth'};
  const element = {scrollLeft: 4, scrollTop: 9, scrollTo(this: HTMLElement, supplied: ScrollToOptions) {assert.equal(this, element);assert.equal(supplied, options);count++;}} as HTMLElement;
  scrollElementTo(element, options);assert.equal(count, 1);assert.equal(element.scrollLeft, 4);assert.equal(element.scrollTop, 9);
});
test('missing window scrollTo uses scrollingElement or documentElement, never invokes missing methods', () => {
  const root = {scrollLeft: 10, scrollTop: 200};
  const view = {document: {scrollingElement: root, documentElement: null}} as unknown as Window;
  scrollWindowTo({top: 0, behavior: 'smooth'}, view);assert.deepEqual(root, {scrollLeft: 10, scrollTop: 0});
  const fallback = {scrollLeft: 10, scrollTop: 50};
  scrollWindowTo({left: 0, top: 125}, {document: {scrollingElement: null, documentElement: fallback}} as unknown as Window);assert.deepEqual(fallback, {scrollLeft: 0, scrollTop: 125});
});
test('native window API preserves smooth options and binding;unrelated native failures are not hidden', () => {
  const options: ScrollToOptions = {top: 0, behavior: 'smooth'};let calls = 0;
  const view = {scrollTo(this: Window, input: ScrollToOptions) {assert.equal(this, view);assert.equal(input, options);calls++;}} as Window;
  scrollWindowTo(options, view);assert.equal(calls, 1);
  const broken = {scrollTo() {throw new Error('unrelated-native-failure');}} as unknown as HTMLElement;
  assert.throws(() => scrollElementTo(broken, {top: 1}), /unrelated-native-failure/u);
});
