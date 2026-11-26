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
assert.equal(index.baseline, storefrontSearchBaseline);
export const storefrontSearchPins = index.entries;
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
    const original = fromGit(storefrontSearchBaseline, file);
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

export function pathsBeforeStorefrontSearch(files, reference) {
  return files.filter(file => {
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
