import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, '..');
const runtimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-supplier-payment-runtime.mjs',
);

test('supplier payment idempotency and restricted direct writes pass in isolated Supabase', async () => {
  const { stdout } = await execFileAsync(process.execPath, [runtimeScript], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });

  const result: { ok?: boolean } = JSON.parse(stdout);
  assert.equal(result.ok, true);
});
