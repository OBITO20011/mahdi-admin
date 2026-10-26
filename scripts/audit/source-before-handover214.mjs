import {restoreEnvironmentSourceHashes} from './source-before-environments.mjs';
import {sourceBeforeReset214} from './source-before-reset214.mjs';
// Exact outer inverse: old acceptance evidence retains its original sources.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const handover214Pins = JSON.parse(readFileSync(new URL('./handover214-inverse.json', import.meta.url), 'utf8')).entries;
const hash = text => createHash('sha256').update(text).digest('hex');
const older = new Map();
for (const file of readdirSync(import.meta.dirname).filter(f => f.endsWith('-hunks.json') || ['handover213-inverse.json', 'owner-acl212-inverse.json'].includes(f))) {
  const entries = JSON.parse(readFileSync(new URL('./' + file, import.meta.url), 'utf8')).entries;
  for (const [name, pin] of Object.entries(entries)) {
    const hashes = older.get(name) ?? new Set();
    for (const digest of [pin.before, pin.after, ...(pin.approvedHistoricalSnapshots ?? []).map(p => p.sha256)].filter(Boolean)) hashes.add(digest);
    older.set(name, hashes);
  }
}
export function sourceBeforeHandover214(file, text) {
  if (text === null) return null;
  const source = sourceBeforeReset214(file,text), pin = handover214Pins[file];
  if (!pin) return source;
  const digest = hash(source);
  if (digest === pin.after) {
    assert.equal(hash(pin.beforeText), pin.before, 'HANDOVER214_CORRUPT_INVERSE:' + file);
    return pin.added ? null : pin.beforeText;
  }
  if (digest === pin.before || older.get(file)?.has(digest)) return source;
  assert.fail('HANDOVER214_UNREVIEWED_SOURCE:' + file);
}
export function pathsBeforeHandover214(files) {
  return files.filter(file => {
    const pin = handover214Pins[file];
    if (!pin) return true;
    assert.equal(hash(readFileSync(new URL('../../' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n')), pin.after,
      'HANDOVER214_UNREVIEWED_SUPABASE_PATH:' + file);
    return false;
  });
}
export function restoreHandover214SourceHashes(sources) {
  sources=restoreEnvironmentSourceHashes(sources);
  return sources.flatMap(entry => {
    const pin = handover214Pins[entry.file];
    if (!pin || entry.sha256 === pin.before || older.get(entry.file)?.has(entry.sha256)) return [entry];
    assert.equal(entry.sha256, pin.after, 'HANDOVER214_SOURCE_HASH:' + entry.file);
    const text = sourceBeforeHandover214(entry.file, readFileSync(new URL('../../' + entry.file, import.meta.url), 'utf8'));
    return text === null ? [] : [{...entry, sha256: hash(text)}];
  });
}
export function projectHandover214QuerySites(source, parseSource) {
  const entries = [];
  for (const file of new Set(source.entries.map(entry => entry.file))) {
    const supplied = source.entries.filter(entry => entry.file === file), pin = handover214Pins[file];
    if (!pin || source.sources.find(entry => entry.file === file)?.sha256 !== pin.after) {entries.push(...supplied); continue;}
    const raw = readFileSync(new URL('../../' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    const current = parseSource(file, raw).entries, keys = Object.keys(current[0] ?? {});
    assert.deepEqual(supplied.map(entry => Object.fromEntries(keys.map(key => [key, entry[key]]))), current, 'HANDOVER214_QUERY_INVENTORY_DRIFT:' + file);
    const before = sourceBeforeHandover214(file, raw);
    if (before === null) {assert.equal(current.length, 0, '214_NO_NEW_DIRECT_TABLE_QUERY'); continue;}
    const restored = parseSource(file, before).entries;
    assert.equal(restored.length, current.length, '214_DIRECT_QUERY_COUNT_CHANGED');
    entries.push(...supplied.map((entry, index) => ({...entry, ...restored[index]})));
  }
  return {...source, entries, sources: restoreHandover214SourceHashes(source.sources)};
}
