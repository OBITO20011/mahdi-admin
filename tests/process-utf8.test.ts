import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PassThrough} from 'node:stream';
import {readFileSync} from 'node:fs';
import {decodeProcessUtf8} from '../scripts/testing/process-utf8.mjs';

test('process UTF-8 decoder preserves Arabic across every byte boundary on both streams', () => {
  const text = 'نكهة أ';
  const bytes = Buffer.from(text);
  assert.notEqual(bytes.subarray(0, -1).toString() + bytes.subarray(-1).toString(), text);
  for (let split = 1; split < bytes.length; split += 1) {
    const child = {stdout: new PassThrough(), stderr: new PassThrough()};
    decodeProcessUtf8(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', value => {stdout += value;});
    child.stderr.on('data', value => {stderr += value;});
    for (const stream of [child.stdout, child.stderr]) {
      stream.write(bytes.subarray(0, split));
      stream.end(bytes.subarray(split));
    }
    assert.equal(stdout, text);
    assert.equal(stderr, text);
  }
});

test('previously unencoded runtime captures use the shared UTF-8 boundary', () => {
  for (const file of ['package-d-pos-recovery-runtime.ts', 'run-canonical-schema-runtime.mjs',
    'run-phase6-package-a-runtime.mjs', 'run-phase2-configurable-receiving-runtime.mjs']) {
    const source = readFileSync(new URL(`../scripts/testing/${file}`, import.meta.url), 'utf8');
    assert.match(source, /import \{decodeProcessUtf8\} from '\.\/process-utf8\.mjs'/u);
    assert.ok(source.includes('decodeProcessUtf8(child);'), file);
  }
  const phase2 = readFileSync(new URL('../scripts/testing/run-phase2-configurable-receiving-runtime.mjs', import.meta.url), 'utf8');
  assert.match(phase2, /decodeProcessUtf8\(gate\);\s*gate.stdout.on/u);
});
