import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  pathsBeforeEmptyStorageRestore,
  restoreEmptyStorageSourceHashes,
  sourceBeforeEmptyStorageRestore,
} from '../scripts/audit/source-before-empty-storage-restore.mjs';

const baseline = '96cf7b9553aac99be655a5a342d801b99367ca66';
const files = [
  'scripts/backup/complete-backup.mjs',
  'scripts/testing/run-dual-backup-runtime.mjs',
];
const canonical = (text: string) => text.replaceAll('\r\n', '\n');
const hash = (text: string) => createHash('sha256').update(canonical(text)).digest('hex');

test('empty-image restore history admits only exact current bytes and preserves unknown changes', () => {
  for (const file of files) {
    const current = readFileSync(file, 'utf8');
    const before = execFileSync('git', ['show', baseline + ':' + file], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(canonical(sourceBeforeEmptyStorageRestore(file, current)!), canonical(before));
    const changed = current + '\n// unrelated edit';
    assert.equal(sourceBeforeEmptyStorageRestore(file, changed), changed);
    assert.deepEqual(restoreEmptyStorageSourceHashes([{file, sha256: hash(current)}]), [
      {file, sha256: hash(before)},
    ]);
    assert.deepEqual(restoreEmptyStorageSourceHashes([{file, sha256: 'unknown'}]), [
      {file, sha256: 'unknown'},
    ]);
  }
  assert.deepEqual(pathsBeforeEmptyStorageRestore(files, baseline), []);
  assert.deepEqual(pathsBeforeEmptyStorageRestore(['src/App.tsx'], baseline), ['src/App.tsx']);
  assert.equal(sourceBeforeEmptyStorageRestore('src/App.tsx', 'unknown'), 'unknown');
});
