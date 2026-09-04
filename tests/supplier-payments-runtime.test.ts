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
const ordersPaginationRuntimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-operational-orders-pagination-runtime.mjs',
);

test(
  'isolated Supabase runtime suites do not compete for Docker resources',
  { timeout: 1_200_000 },
  async (context) => {
    await context.test(
      'supplier payment idempotency and restricted direct writes pass',
      async () => {
        const { stdout } = await execFileAsync(process.execPath, [runtimeScript], {
          cwd: projectRoot,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          timeout: 600_000,
        });

        const result: { ok?: boolean } = JSON.parse(stdout);
        assert.equal(result.ok, true);
      },
    );

    await context.test(
      'operational orders paging, search and role gates pass',
      async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [ordersPaginationRuntimeScript],
          {
            cwd: projectRoot,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            timeout: 600_000,
          },
        );

        const result: { ok?: boolean; runtime_scenarios?: number } =
          JSON.parse(stdout);
        assert.equal(result.ok, true);
        assert.equal(result.runtime_scenarios, 9);
      },
    );
  },
);
