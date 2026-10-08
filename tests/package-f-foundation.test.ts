import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  debtAgeBucket,
  formatJod,
  formatMinorUnits,
  formatSignedJod,
  ratioToPercent,
  toneClasses,
  toneFillClasses,
  toneTextClasses,
} from '../src/components/ui/uiFormat.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const tokensCss = read('src/styles/design-tokens.css');

const block = (selector: string) => {
  const start = tokensCss.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing ${selector}`);
  return tokensCss.slice(start, tokensCss.indexOf('}', start));
};

// Owner-approved palette (spec §1). Literal constants, not read back from the CSS under test.
const approved: Record<string, [light: string, dark: string]> = {
  bg: ['#f4f6f9', '#0b1220'],
  surface: ['#ffffff', '#121b2e'],
  'surface-2': ['#f7f9fc', '#0f172a'],
  border: ['#e3e8ef', '#22304a'],
  text: ['#0f1b2d', '#e6ebf2'],
  muted: ['#55657a', '#9aa8bc'],
  primary: ['#13294b', '#f08a3c'],
  'on-primary': ['#ffffff', '#1b1004'],
  accent: ['#e2731f', '#e2731f'],
  side: ['#13294b', '#080e1a'],
  hero: ['#13294b', '#16243f'],
  'sel-row': ['#fff6ee', '#1a2640'],
  ok: ['#0f6b3d', '#5dd39e'],
  'ok-bg': ['#e3f4ea', '#0e2e20'],
  warn: ['#8a5300', '#f5b95c'],
  'warn-bg': ['#fdf0d9', '#33240a'],
  bad: ['#b42318', '#ff8f86'],
  'bad-bg': ['#fde7e5', '#3a1515'],
  info: ['#1d4ed8', '#8fb4ff'],
  'info-bg': ['#e3ecfd', '#14264a'],
};

test('design tokens carry the approved light and dark palette', () => {
  const light = block(':root');
  const dark = block('html.theme-dark');
  for (const [name, [lightValue, darkValue]] of Object.entries(approved)) {
    assert.match(light, new RegExp(`--nw-${name}:\\s*${lightValue};`), `light ${name}`);
    assert.match(dark, new RegExp(`--nw-${name}:\\s*${darkValue};`), `dark ${name}`);
  }
});

test('every token is exposed as a Tailwind colour and both themes define the same set', () => {
  const names = (css: string) => [...css.matchAll(/--nw-([a-z0-9-]+):/g)].map((match) => match[1]).sort();
  const lightNames = names(block(':root'));
  assert.deepEqual(names(block('html.theme-dark')), lightNames);
  const theme = block('@theme inline');
  for (const name of lightNames) {
    assert.match(theme, new RegExp(`--color-nw-${name}:\\s*var\\(--nw-${name}\\);`), name);
  }
  assert.match(theme, /--font-sans:\s*"IBM Plex Sans Arabic"/);
  assert.match(read('src/index.css'), /@import "tailwindcss";\s*@import "\.\/styles\/design-tokens\.css";/);
});

test('the Arabic font is self-hosted so the admin CSP font-src stays self-only', () => {
  const main = read('src/main.tsx');
  for (const weight of [400, 500, 600, 700]) {
    assert.match(main, new RegExp(`@fontsource/ibm-plex-sans-arabic/${weight}\\.css`));
  }
  assert.doesNotMatch(read('index.html'), /fonts\.googleapis|fonts\.gstatic/);
  assert.match(read('public/_headers'), /font-src 'self' data:;/);
});

test('money formatting keeps three decimals, grouping and safe edges', () => {
  assert.equal(formatJod(1284.5), '1,284.500');
  assert.equal(formatJod(0), '0.000');
  assert.equal(formatJod(-0), '0.000');
  assert.equal(formatJod(Number.NaN), '—');
  assert.equal(formatMinorUnits(1284500), '1,284.500');
  assert.equal(formatMinorUnits(5), '0.005');
  assert.equal(formatMinorUnits(-42000), '-42.000');
  assert.equal(formatMinorUnits(123456789012345678n), '123,456,789,012,345.678');
  assert.equal(formatMinorUnits(1.5), '—');
  assert.equal(formatSignedJod(92.4), '+92.400');
  assert.equal(formatSignedJod(-42), '−42.000');
  assert.equal(formatSignedJod(0), '0.000');
});

test('debt-age buckets and bar ratios follow the spec boundaries', () => {
  assert.equal(debtAgeBucket(0), 'fresh');
  assert.equal(debtAgeBucket(7), 'fresh');
  assert.equal(debtAgeBucket(8), 'aging');
  assert.equal(debtAgeBucket(30), 'aging');
  assert.equal(debtAgeBucket(31), 'overdue');
  assert.equal(ratioToPercent(860.5, 800), '100%');
  assert.equal(ratioToPercent(48, 104), '46%');
  assert.equal(ratioToPercent(-5, 10), '0%');
  assert.equal(ratioToPercent(5, 0), '0%');
});

test('tone maps cover every tone with token classes only', () => {
  const tones = ['ok', 'warn', 'bad', 'info', 'mute'];
  for (const map of [toneClasses, toneTextClasses, toneFillClasses]) {
    assert.deepEqual(Object.keys(map).sort(), [...tones].sort());
    for (const value of Object.values(map)) assert.match(value, /^(?:(?:bg|text)-nw-[a-z-]+\s?)+$/);
  }
});

test('the Package F UI kit uses tokens, never raw slate/blue/gray colours', () => {
  const directory = 'src/components/ui/';
  for (const file of readdirSync(directory).filter((name) => /\.(tsx|ts)$/.test(name))) {
    const source = read(directory + file);
    assert.doesNotMatch(source, /\b(?:bg|text|border|ring|from|to|via)-(?:slate|blue|gray|indigo|zinc|neutral)-\d/, file);
  }
});
