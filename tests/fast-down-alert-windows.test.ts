import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  pathsBeforeStorefrontSearch, restoreStorefrontSearchHashes, sourceBeforeStorefrontSearch, storefrontSearchPins,
} from '../scripts/audit/source-before-storefront-search.mjs';

const watch = readFileSync('scripts/monitoring/run-fast-down-alert.ps1', 'utf8');
const install = readFileSync('scripts/monitoring/register-fast-down-alert.ps1', 'utf8');

test('historical validation projects only exact reviewed alert sources, including Windows files', () => {
  const files = [
    'docs/operations/FAST_DOWN_ALERT_AR.md',
    'scripts/monitoring/fast-down-alert-windows.ps1',
    'scripts/monitoring/fast-down-alert.mjs',
    'scripts/monitoring/register-fast-down-alert.ps1',
    'scripts/monitoring/run-fast-down-alert.ps1',
    'scripts/testing/test-fast-down-alert-windows.ps1',
    'tests/fast-down-alert-windows.test.ts',
    'tests/fast-down-alert.test.ts',
  ];
  const digest = (text: string) => createHash('sha256').update(text.replace(/\r\n?/gu, '\n')).digest('hex');
  assert.deepEqual(pathsBeforeStorefrontSearch(files), []);
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const unknown = raw + 'unreviewed';
    assert.equal(storefrontSearchPins[file].before, null);
    assert.equal(storefrontSearchPins[file].after, digest(raw));
    assert.equal(sourceBeforeStorefrontSearch(file, raw), null);
    assert.equal(sourceBeforeStorefrontSearch(file, unknown), unknown);
    const row = {file, sha256: digest(unknown)};
    assert.deepEqual(restoreStorefrontSearchHashes([{file, sha256: digest(raw)}, row]), [row]);
  }
});

test('Windows task is bounded, non-overlapping, and runs the protected installer copy as SYSTEM', () => {
  assert.match(install, /Nawasrah Fast Down Alert/u);
  assert.match(install, /-Verb RunAs/u);
  assert.match(install, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/u);
  assert.match(install, /New-ScheduledTaskTrigger -AtStartup/u);
  assert.match(install, /MultipleInstances = 'IgnoreNew'/u);
  assert.match(install, /ExecutionTimeLimit = New-TimeSpan -Seconds 35/u);
  assert.match(install, /New-ScheduledTaskPrincipal -UserId 'SYSTEM'/u);
  assert.match(install, /\$runner = Join-Path \$installed/u);
  assert.match(watch, /WaitForExit\(26000\)/u);
  assert.match(watch, /finally[\s\S]*EnvironmentVariables\.Clear\(\)/u);
  assert.match(watch, /StandardOutput\.BaseStream\.CopyToAsync\(\[IO\.Stream\]::Null\)/u);
  assert.match(watch, /StandardError\.BaseStream\.CopyToAsync\(\[IO\.Stream\]::Null\)/u);
  assert.doesNotMatch(watch, /Exception\.Message|\$env:/u);
});

test('Windows validates DPAPI fixtures and child-only environment without task registration', {
  skip: process.platform !== 'win32',
}, () => {
  const output = execFileSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', 'scripts/testing/test-fast-down-alert-windows.ps1',
  ], {encoding: 'utf8', timeout: 20_000, windowsHide: true, stdio: ['ignore','pipe','pipe']});
  assert.equal(output.trim(), 'FAST_DOWN_WINDOWS_FIXTURES_OK');
});
