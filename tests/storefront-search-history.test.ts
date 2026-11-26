import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

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
