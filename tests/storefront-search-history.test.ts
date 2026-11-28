import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {sha256} from '../scripts/testing/maintenance-db-contract.mjs';
import {pathsBeforeStorefrontSearch,storefrontHeroPriorHash} from '../scripts/audit/source-before-storefront-search.mjs';

test('historical text checks recognize only exact reviewed hero transcodes', () => {
  const base = 'e5e922892a9f89e2adf526e7c362bccc331395a5';
  const paths = ['desktop-1080p', 'mobile'].map(name => 'customer-web/public/nawasrah-hero-' + name + '.mp4');
  for (const file of paths) {
    const bytes = readFileSync(file);
    const original = execFileSync('git', ['show', base + ':' + file], {maxBuffer: 8 * 1024 ** 2});
    assert.equal(storefrontHeroPriorHash(file, bytes), sha256(original));
    assert.equal(storefrontHeroPriorHash(file, Buffer.concat([bytes, Buffer.from([0])])), null);
    assert.equal(storefrontHeroPriorHash('customer-web/public/unknown.mp4', bytes), null);
  }
  assert.deepEqual(pathsBeforeStorefrontSearch(paths, base), []);
});

test('historical upgrade references still project the exact catalog source without network or subprocesses', () => {
  const offline = `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const deny = () => { throw Error('OFFLINE_NETWORK_OR_SUBPROCESS_FORBIDDEN'); };
    globalThis.fetch = deny;
    childProcess.execFileSync = deny;
    childProcess.spawn = deny;
    syncBuiltinESMExports();
    const { inventory } = await import('./scripts/audit/table-access-inventory.mjs');
    const { upgradeReferenceProof, upgradeReferenceSource } = await import('./scripts/operations/upgrade-versioned-reference.mjs');
    for (const version of [222, 223]) {
      const proof = JSON.parse(await upgradeReferenceProof(process.cwd(), version));
      const actual = await inventory({ projectSource: (file, text) => upgradeReferenceSource(version, file, text) });
      assert.deepEqual(actual.sources, proof.sourceHashes);
      const unknown = 'unreviewed source';
      assert.equal(upgradeReferenceSource(version, 'customer-web/src/App.tsx', unknown), unknown);
    }
    console.log('OFFLINE_HISTORICAL_SEARCH_SOURCE_OK');
  `;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', offline], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim(), 'OFFLINE_HISTORICAL_SEARCH_SOURCE_OK');
});
