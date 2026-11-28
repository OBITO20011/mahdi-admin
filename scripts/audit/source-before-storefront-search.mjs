import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {canonicalLf, sha256} from '../testing/maintenance-db-contract.mjs';

// Only historical tests and reference projections use these exact source versions.
export const storefrontSearchBaseline = '16a5f18db1df96f4e63bfd38ed68ed0ff439b98f';
const indexFile = 'scripts/audit/storefront-search-source-pins.json';
const current = file => canonicalLf(readFileSync(new URL('../../' + file, import.meta.url), 'utf8'));
const indexText = current(indexFile);
const index = JSON.parse(indexText);
assert.equal(index.format, 1);
assert.equal(index.baseline, storefrontSearchBaseline);
export const storefrontSearchPins = index.entries;
const mediaPins = index.heroMedia ?? {};
for (const [file, pin] of Object.entries(mediaPins)) {
  assert.match(file, /^customer-web\/public\/nawasrah-hero-(?:desktop-1080p|mobile)\.mp4$/u);
  assert.match(pin.before, /^[0-9a-f]{64}$/u);
  assert.match(pin.after, /^[0-9a-f]{64}$/u);
  assert.notEqual(pin.before, pin.after);
}
const originals = new Map();
const fromGit = (reference, file) => canonicalLf(execFileSync('git', ['show', reference + ':' + file], {
  cwd: new URL('../..', import.meta.url),
  encoding: 'utf8',
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: 32 * 1024 ** 2,
}));

export function sourceBeforeStorefrontSearch(file, text) {
  if (text === null) return null;
  if (file === indexFile && canonicalLf(text) === indexText) return null;
  const pin = storefrontSearchPins[file];
  if (!pin || sha256(canonicalLf(text)) !== pin.after) return text;
  if (pin.before === null) return null;
  if (!originals.has(file)) {
    // Dry-run references also use this view with child processes forbidden.
    const lines = canonicalLf(text).split('\n');
    for (const {start, afterCount, beforeLines} of pin.inverse.toReversed()) {
      lines.splice(start, afterCount, ...beforeLines);
    }
    const original = lines.join('\n');
    assert.equal(sha256(original), pin.before, 'STOREFRONT_SEARCH_HISTORY_BASELINE_DRIFT:' + file);
    originals.set(file, original);
  }
  return originals.get(file);
}

export function restoreStorefrontSearchHashes(rows) {
  return rows.flatMap(row => {
    const pin = storefrontSearchPins[row.file];
    if (!pin || row.sha256 !== pin.after) return [row];
    assert.equal(sha256(current(row.file)), pin.after, 'STOREFRONT_SEARCH_HISTORY_SOURCE_CHANGED:' + row.file);
    return pin.before === null ? [] : [{...row, sha256: pin.before}];
  });
}

// Binary clips do not enter the text history or current runtime source hashes.
// Only the exact transcodes may project back to the reviewed pre-CWV assets.
export function storefrontHeroPriorHash(file, bytes) {
  if (!Object.hasOwn(mediaPins, file)) return null;
  const pin = mediaPins[file];
  return sha256(bytes) === pin.after ? pin.before : null;
}

export function pathsBeforeStorefrontSearch(files, reference) {
  return files.filter(file => {
    if (Object.hasOwn(mediaPins, file)) {
      const before = storefrontHeroPriorHash(file, readFileSync(new URL('../../' + file, import.meta.url)));
      if (before === null) return true;
      if (!reference) return false;
      try {
        const original = execFileSync('git', ['show', reference + ':' + file], {
          cwd: new URL('../..', import.meta.url),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 8 * 1024 ** 2,
        });
        return sha256(original) !== before;
      } catch {
        return true;
      }
    }
    if (file !== indexFile && !storefrontSearchPins[file]) return true;
    const raw = current(file);
    const before = sourceBeforeStorefrontSearch(file, raw);
    if (before === null) return false;
    if (before === raw || !reference) return true;
    try {
      return sha256(fromGit(reference, file)) !== sha256(before);
    } catch {
      return true;
    }
  });
}
