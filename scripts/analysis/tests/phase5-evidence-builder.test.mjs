import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertJsonCsvSemanticEquivalence,
  build,
  buildAndPublish,
  buildOwnerEvidenceRows,
  createArtifactSet,
  directWrites,
  functionEvents,
  publicCallSites,
  repositoryCallerEdges,
  sourceClassification,
  validateOwnerEvidenceRows,
  validateSourceCoverage,
} from '../build-phase5-authority-ledger.mjs';

function temporaryDirectory(name) {
  const directory = join(tmpdir(), `${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function write(root, path, content = '') {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function initializeRepository(root) {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'phase5-evidence@example.invalid']);
  git(root, ['config', 'user.name', 'Phase 5 Evidence Fixture']);
}

function writeMigrationSequence(root) {
  for (let sequence = 1; sequence <= 122; sequence += 1) {
    const prefix = String(sequence).padStart(3, '0');
    write(root, `supabase/migrations/${prefix}_fixture.sql`, `-- migration ${prefix}\n`);
  }
}

function validOwnerRow({ sourceProven = false, authorityClass = 'A' } = {}) {
  const [row] = buildOwnerEvidenceRows([{
    signature: 'public.fixture(uuid)',
    relevance_class: 'R1',
    authority_class_if_relevant: authorityClass,
    final_owner: sourceProven ? 'postgres' : null,
    owner_source_migration: sourceProven ? '001_fixture.sql' : null,
    owner_source_location: sourceProven ? 10 : null,
    security_mode: 'DEFINER',
    search_path: 'public, pg_temp',
    target_activation_disposition: authorityClass === 'B'
      ? 'REVOKE_DIRECT_EXECUTE_FROM_PUBLIC_ANON_AUTHENTICATED_SERVICE_ROLE'
      : 'ALLOWLIST_APPROVED_COORDINATOR',
  }]);
  return row;
}

test('function evolution is applied in exact intra-migration order and exact overload', () => {
  const source = `
    CREATE FUNCTION public.f(p_value integer) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT p_value $$;
    CREATE FUNCTION public.f(p_value text) RETURNS text LANGUAGE sql AS $$ SELECT p_value $$;
    GRANT EXECUTE ON FUNCTION public.f(integer) TO authenticated;
    ALTER FUNCTION public.f(integer) SECURITY INVOKER;
    ALTER FUNCTION public.f(integer) RENAME TO f_renamed;
    CREATE OR REPLACE FUNCTION public.f_renamed(p_value integer) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT p_value + 1 $$;
    REVOKE EXECUTE ON FUNCTION public.f_renamed(integer) FROM authenticated;
    ALTER FUNCTION public.f(text) SECURITY DEFINER;
  `;
  const result = functionEvents([{ filename: '001_fixture.sql', source }]);
  const renamed = result.state.get('public.f_renamed(int)');
  const text = result.state.get('public.f(text)');
  assert.equal(result.state.has('public.f(int)'), false);
  assert.equal(renamed.securityMode, 'DEFINER');
  assert.equal(renamed.acl.authenticated, false);
  assert.equal(text.securityMode, 'DEFINER');
  assert.equal(text.acl.authenticated, false);
});

test('DROP then CREATE resets ACL while CREATE OR REPLACE preserves ACL', () => {
  const result = functionEvents([{ filename: '001_fixture.sql', source: `
    CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
    GRANT EXECUTE ON FUNCTION public.f() TO authenticated;
    CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;
    DROP FUNCTION public.f();
    CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 3 $$;
  ` }]);
  assert.equal(result.state.get('public.f()').acl.authenticated, false);
  assert.equal(result.state.get('public.f()').acl.public, true);
});

test('nested public calls are all discovered while strings and comments are ignored', () => {
  const calls = publicCallSites(`
    PERFORM public.outer_call(public.inner_call(1), public.second_inner());
    -- public.comment_only()
    SELECT 'public.string_only()';
  `).map((row) => `${row.name}:${row.argument_count}`);
  assert.deepEqual(calls, ['inner_call:1', 'outer_call:2', 'second_inner:0']);
});

test('nested calls at depth two and across multiple arguments are discovered once', () => {
  const calls = publicCallSites(`
    SELECT public.a(public.b(public.c()));
    PERFORM public.x(1, public.b(), public.c(public.d()));
  `).map((row) => `${row.name}:${row.argument_count}`);
  assert.deepEqual(calls, ['a:1', 'b:0', 'b:1', 'c:0', 'c:1', 'd:0', 'x:3']);
});

test('row-lock syntax is not classified as DML', () => {
  assert.deepEqual(directWrites(`
    SELECT * FROM public.orders FOR UPDATE NOWAIT;
    SELECT * FROM public.orders FOR UPDATE SKIP LOCKED;
    UPDATE public.orders SET status = 'x';
  `), ['orders']);
});

test('required source inventory rejects a missing file while its root still exists', () => {
  const root = temporaryDirectory('phase5-source-file-loss');
  try {
    const paths = ['src/a.ts', 'customer-web/src/a.ts', 'supabase/functions/a.ts', 'scripts/a.mjs', 'supabase/migrations/001_a.sql'];
    for (const path of paths) write(root, path);
    validateSourceCoverage(root, paths);
    rmSync(join(root, 'src', 'a.ts'));
    assert.throws(() => validateSourceCoverage(root, paths), /Trusted source files missing/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('required source inventory rejects an omitted migration', () => {
  const root = temporaryDirectory('phase5-migration-loss');
  const paths = ['src/a.ts', 'customer-web/src/a.ts', 'supabase/functions/a.ts', 'scripts/a.mjs', 'supabase/migrations/001_a.sql'];
  try {
    for (const path of paths) write(root, path);
    rmSync(join(root, 'supabase', 'migrations', '001_a.sql'));
    assert.throws(() => validateSourceCoverage(root, paths), /Trusted source files missing/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('analysis tooling is explicitly excluded from the runtime caller surface', () => {
  const root = temporaryDirectory('phase5-source-root-loss');
  try {
    const paths = ['scripts/analysis/a.mjs', 'supabase/migrations/001_a.sql'];
    for (const path of paths) write(root, path);
    const coverage = validateSourceCoverage(root, paths);
    const analysis = coverage.source_coverage_ledger.find((entry) => entry.path === 'scripts/analysis/a.mjs');
    assert.equal(analysis.scan_policy, 'EXPLICIT_EXCLUSION');
    assert.match(analysis.exclusion_reason, /not be counted as a business\/runtime caller/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('trusted Git baseline rejects a copy that deleted Migration 015 and committed the deletion', () => {
  const root = temporaryDirectory('phase5-independent-baseline');
  try {
    initializeRepository(root);
    writeMigrationSequence(root);
    write(root, 'src/runtime.ts', 'export const runtime = true;\n');
    git(root, ['add', '--all']);
    git(root, ['commit', '-qm', 'trusted baseline']);
    const trustedCommit = git(root, ['rev-parse', 'HEAD']);
    rmSync(join(root, 'supabase', 'migrations', '015_fixture.sql'));
    git(root, ['add', '--all']);
    git(root, ['commit', '-qm', 'damaged copy']);
    assert.throws(() => validateSourceCoverage(root, { commit: trustedCommit }), /015_fixture\.sql/u);

    git(root, ['checkout', trustedCommit, '--', 'supabase/migrations']);
    write(root, 'supabase/migrations/016_fixture.sql', '-- silently replaced migration 016\n');
    assert.throws(() => validateSourceCoverage(root, { commit: trustedCommit }), /identity mismatch:[\s\S]*016_fixture\.sql/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('direct blob comparison rejects assume-unchanged migration and runtime tampering', () => {
  const root = temporaryDirectory('phase5-assume-unchanged-bypass');
  try {
    initializeRepository(root);
    writeMigrationSequence(root);
    write(root, 'src/runtime.ts', 'export const runtime = true;\n');
    git(root, ['add', '--all']);
    git(root, ['commit', '-qm', 'trusted baseline']);
    const trustedCommit = git(root, ['rev-parse', 'HEAD']);

    const migration = 'supabase/migrations/015_fixture.sql';
    write(root, migration, '-- migration 015\nSELECT 15;\n');
    git(root, ['update-index', '--assume-unchanged', migration]);
    assert.throws(() => validateSourceCoverage(root, { commit: trustedCommit }), /identity mismatch:[\s\S]*015_fixture\.sql/u);
    git(root, ['update-index', '--no-assume-unchanged', migration]);
    git(root, ['checkout', '--', migration]);

    write(root, 'src/runtime.ts', 'export const runtime = false;\n');
    git(root, ['update-index', '--assume-unchanged', 'src/runtime.ts']);
    assert.throws(() => validateSourceCoverage(root, { commit: trustedCommit }), /identity mismatch:[\s\S]*src\/runtime\.ts/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('direct blob comparison rejects skip-worktree migration tampering', () => {
  const root = temporaryDirectory('phase5-skip-worktree-bypass');
  try {
    initializeRepository(root);
    writeMigrationSequence(root);
    write(root, 'src/runtime.ts', 'export const runtime = true;\n');
    git(root, ['add', '--all']);
    git(root, ['commit', '-qm', 'trusted baseline']);
    const trustedCommit = git(root, ['rev-parse', 'HEAD']);
    const migration = 'supabase/migrations/016_fixture.sql';
    git(root, ['update-index', '--skip-worktree', migration]);
    write(root, migration, '-- migration 016\nSELECT 16;\n');
    assert.throws(() => validateSourceCoverage(root, { commit: trustedCommit }), /identity mismatch:[\s\S]*016_fixture\.sql/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('source identity canonicalizes only line endings and still detects real content changes', () => {
  const root = temporaryDirectory('phase5-content-canonicalization');
  try {
    initializeRepository(root);
    writeMigrationSequence(root);
    write(root, 'src/runtime.ts', 'export const runtime = true;\nexport const value = 1;\n');
    git(root, ['add', '--all']);
    git(root, ['commit', '-qm', 'trusted baseline']);
    const trustedCommit = git(root, ['rev-parse', 'HEAD']);
    writeFileSync(join(root, 'src/runtime.ts'), 'export const runtime = true;\r\nexport const value = 1;\r\n', 'utf8');
    const coverage = validateSourceCoverage(root, { commit: trustedCommit });
    const row = coverage.source_coverage_ledger.find((entry) => entry.path === 'src/runtime.ts');
    assert.equal(row.identity_match, true);
    assert.equal(row.raw_identity_match, false);
    assert.equal(row.identity_comparison, 'UTF8_TEXT_CANONICAL_LF_ONLY');
    writeFileSync(join(root, 'src/runtime.ts'), 'export const runtime = true;\r\nexport const value = 2;\r\n', 'utf8');
    assert.throws(() => validateSourceCoverage(root, { commit: trustedCommit }), /identity mismatch:[\s\S]*src\/runtime\.ts/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('new runtime-like source family fails closed until classified', () => {
  const root = temporaryDirectory('phase5-unclassified-family');
  try {
    const paths = ['new-runtime/worker.ts', 'supabase/migrations/001_fixture.sql'];
    for (const path of paths) write(root, path);
    assert.equal(sourceClassification('new-runtime/worker.ts').policy, 'UNCLASSIFIED');
    assert.throws(() => validateSourceCoverage(root, paths), /Unclassified runtime-like source files/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unresolved ALTER FUNCTION rename and configuration targets fail closed', () => {
  assert.throws(() => functionEvents([{ filename: '001_fixture.sql', source: 'ALTER FUNCTION public.missing() RENAME TO still_missing;' }]), /target missing/u);
  assert.throws(() => functionEvents([{ filename: '001_fixture.sql', source: 'ALTER FUNCTION public.missing(text) SET search_path TO public, pg_temp;' }]), /target missing/u);
  assert.throws(() => functionEvents([{ filename: '001_fixture.sql', source: `
    CREATE FUNCTION public.overloaded(integer) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
    ALTER FUNCTION public.overloaded(text) SECURITY INVOKER;
  ` }]), /public\.overloaded\(text\).*target missing|target missing: public\.overloaded\(text\)/u);
});

test('unknown ALTER FUNCTION form fails closed', () => {
  assert.throws(() => functionEvents([{ filename: '001_fixture.sql', source: `
    CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
    ALTER FUNCTION public.f() SOME_UNKNOWN_ATTRIBUTE;
  ` }]), /Unsupported ALTER FUNCTION form/u);
});

test('CREATE FUNCTION attributes are reconstructed before or after the body', () => {
  const result = functionEvents([{ filename: '001_fixture.sql', source: `
    CREATE FUNCTION public.before_body() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path TO public, pg_temp AS $$ SELECT 1 $$;
    CREATE FUNCTION public.after_body() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public;
  ` }]);
  assert.equal(result.state.get('public.before_body()').securityMode, 'DEFINER');
  assert.equal(result.state.get('public.before_body()').language, 'sql');
  assert.equal(result.state.get('public.before_body()').searchPath, 'public, pg_temp');
  assert.equal(result.state.get('public.after_body()').securityMode, 'INVOKER');
  assert.equal(result.state.get('public.after_body()').language, 'sql');
  assert.equal(result.state.get('public.after_body()').searchPath, 'pg_catalog, public');
});

test('ALTER FUNCTION search_path is retained and RESET removes it', () => {
  const setResult = functionEvents([{ filename: '001_fixture.sql', source: `
    CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
    ALTER FUNCTION public.f() SET search_path TO public, pg_temp;
  ` }]);
  assert.equal(setResult.state.get('public.f()').searchPath, 'public, pg_temp');
  const resetResult = functionEvents([{ filename: '001_fixture.sql', source: `
    CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SET search_path TO public AS $$ SELECT 1 $$;
    ALTER FUNCTION public.f() RESET search_path;
  ` }]);
  assert.equal(resetResult.state.get('public.f()').searchPath, null);
});

test('ALTER FUNCTION consumes combined actions, RESET ALL, and rejects unknown suffixes', () => {
  const combined = functionEvents([{ filename: '001_fixture.sql', source: `
    CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path TO public AS $$ SELECT 1 $$;
    ALTER FUNCTION public.f() SECURITY INVOKER SET search_path TO pg_catalog, public;
  ` }]);
  assert.equal(combined.state.get('public.f()').securityMode, 'INVOKER');
  assert.equal(combined.state.get('public.f()').searchPath, 'pg_catalog, public');
  assert.deepEqual(combined.alterLedger[0].clauses_applied, ['SECURITY', 'SET_CONFIGURATION']);
  assert.equal(combined.alterLedger[0].fully_consumed, true);

  const resetAll = functionEvents([{ filename: '001_fixture.sql', source: `
    CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SET search_path TO public SET statement_timeout TO 5 AS $$ SELECT 1 $$;
    ALTER FUNCTION public.f() RESET ALL;
  ` }]);
  assert.deepEqual(resetAll.state.get('public.f()').configuration, {});
  assert.equal(resetAll.state.get('public.f()').searchPath, null);

  assert.throws(() => functionEvents([{ filename: '001_fixture.sql', source: `
    CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
    ALTER FUNCTION public.f() SECURITY INVOKER NONSENSE;
  ` }]), /Unsupported ALTER FUNCTION form/u);
});

test('function owner lifecycle is exact-signature aware and fail-closed', () => {
  const result = functionEvents([{ filename: '001_fixture.sql', source: `
    CREATE FUNCTION public.f(integer) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
    CREATE FUNCTION public.f(text) RETURNS text LANGUAGE sql AS $$ SELECT 'x' $$;
    ALTER FUNCTION public.f(integer) OWNER TO owner_a;
    CREATE OR REPLACE FUNCTION public.f(integer) RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;
    ALTER FUNCTION public.f(integer) RENAME TO f_renamed;
    ALTER FUNCTION public.f(text) OWNER TO owner_b;
    DROP FUNCTION public.f(text);
    CREATE FUNCTION public.f(text) RETURNS text LANGUAGE sql AS $$ SELECT 'fresh' $$;
  ` }]);
  const renamed = result.state.get('public.f_renamed(int)');
  const recreated = result.state.get('public.f(text)');
  assert.equal(renamed.owner, 'owner_a');
  assert.equal(renamed.ownerSourceMigration, '001_fixture.sql');
  assert.equal(recreated.owner, null);
  assert.equal(result.ownerAlterations, 2);
  assert.equal(result.resolvedOwnerAlterations, 2);
});

test('source-unknown owner passes pre-activation evidence only with the complete fail-closed policy', () => {
  const row = validOwnerRow();
  const result = validateOwnerEvidenceRows([row]);
  assert.deepEqual(result.failures, []);
  assert.equal(row.current_owner_source_status, 'SOURCE_UNKNOWN');
  assert.equal(row.current_owner_source_value, null);
  assert.equal(result.counters.source_unknown_owner, 1);
});

test('source-unknown owner without target owner fails closed', () => {
  const row = validOwnerRow();
  row.target_owner = null;
  assert.match(validateOwnerEvidenceRows([row]).failures.join('\n'), /target owner policy missing/u);
});

test('source-unknown owner without activation catalog assertion fails closed', () => {
  const row = validOwnerRow();
  row.activation_catalog_verification_required = false;
  assert.match(validateOwnerEvidenceRows([row]).failures.join('\n'), /activation owner catalog assertion missing/u);
});

test('source-unknown owner without convergence disposition fails closed', () => {
  const row = validOwnerRow();
  row.owner_convergence_disposition = null;
  assert.match(validateOwnerEvidenceRows([row]).failures.join('\n'), /owner convergence disposition missing/u);
});

test('source-unknown owner cannot allow unknown final ownership', () => {
  const row = validOwnerRow();
  row.final_owner_unknown_allowed = true;
  assert.match(validateOwnerEvidenceRows([row]).failures.join('\n'), /unknown final owner is allowed/u);
});

test('source-unknown owner cannot become a Slice 1 execution dependency', () => {
  const row = validOwnerRow();
  row.slice1_dependency_on_unknown_owner = true;
  assert.match(validateOwnerEvidenceRows([row]).failures.join('\n'), /Slice 1 dependency/u);
});

test('source-proven postgres owner passes when explicit evidence and policy are complete', () => {
  const row = validOwnerRow({ sourceProven: true });
  const result = validateOwnerEvidenceRows([row]);
  assert.deepEqual(result.failures, []);
  assert.equal(row.current_owner_source_status, 'SOURCE_PROVEN');
  assert.equal(row.current_owner_source_value, 'postgres');
  assert.equal(result.counters.source_proven_owner, 1);
});

test('one missing target owner blocks a multi-signature owner ledger', () => {
  const first = validOwnerRow();
  const second = { ...validOwnerRow({ sourceProven: true }), exact_signature: 'public.second_fixture(uuid)', target_owner: null };
  assert.match(validateOwnerEvidenceRows([first, second]).failures.join('\n'), /second_fixture.*target owner policy missing/u);
});

test('each missing privilege-envelope component fails closed', () => {
  const mutations = [
    ['target_owner', null],
    ['search_path_assertion_required', false],
    ['schema_trust_assertion_required', false],
    ['acl_assertion_required', false],
    ['security_mode_assertion_required', false],
    ['activation_executor_authority_verification_required', false],
  ];
  for (const [field, value] of mutations) {
    const row = validOwnerRow();
    row[field] = value;
    assert.match(validateOwnerEvidenceRows([row]).failures.join('\n'), /privilege envelope incomplete/u, field);
  }
});

test('Class-B owner policy cannot substitute for its exact ACL revoke disposition', () => {
  const row = validOwnerRow({ authorityClass: 'B' });
  row.acl_activation_disposition = 'ALLOWLIST_APPROVED_COORDINATOR';
  assert.match(validateOwnerEvidenceRows([row]).failures.join('\n'), /Class-B ACL revoke disposition missing/u);
});

test('all repository ALTER FUNCTION statements are fully consumed into the ledger', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const migrationRoot = join(root, 'supabase', 'migrations');
  const migrationFiles = readdirSync(migrationRoot)
    .filter((filename) => /^\d{3}.*\.sql$/u.test(filename) && Number(filename.slice(0, 3)) <= 122)
    .sort()
    .map((filename) => ({ filename, source: readFileSync(join(migrationRoot, filename), 'utf8').replace(/\r\n?/gu, '\n') }));
  const result = functionEvents(migrationFiles);
  assert.equal(result.alterStatements, 226);
  assert.equal(result.alterLedger.length, 226);
  assert.equal(result.handledAlterStatements, 226);
  assert.ok(result.alterLedger.every((row) => row.fully_consumed && row.unconsumed_suffix === ''));
  assert.equal(result.ownerAlterations, 165);
  assert.equal(result.resolvedOwnerAlterations, 165);
});

test('direct PostgREST SEO callers are detected without becoming writers', () => {
  const root = temporaryDirectory('phase5-seo-callers');
  try {
    const path = 'customer-web/scripts/generate-seo-pages.mjs';
    write(root, path, `
      await fetch(\`${'${url}'}/rest/v1/rpc/get_public_storefront_catalog_page\`);
      await fetch(\`${'${url}'}/rest/v1/rpc/get_public_storefront_offers\`);
    `);
    const functions = [
      { function_name: 'get_public_storefront_catalog_page', signature: 'public.get_public_storefront_catalog_page()' },
      { function_name: 'get_public_storefront_offers', signature: 'public.get_public_storefront_offers()' },
    ];
    const edges = repositoryCallerEdges(functions, root, [path]);
    assert.equal(edges.length, 2);
    assert.ok(edges.every((edge) => edge.caller_type === 'CUSTOMER_OPERATIONAL_RPC'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('repository-managed automation Edge callers are accounted for', () => {
  const root = temporaryDirectory('phase5-automation-callers');
  try {
    const path = 'automation/n8n/workflows/alerts.json';
    write(root, path, '{"url":"https://example.invalid/functions/v1/n8n-alert-feed"}');
    const edges = repositoryCallerEdges([], root, [path]);
    assert.deepEqual(edges, [{
      caller_type: 'AUTOMATION_EDGE_HTTP',
      caller_location: `${path}:1`,
      callee_name: 'n8n-alert-feed',
      callee_signatures: [],
      resolution: 'EDGE_FUNCTION_ENDPOINT',
    }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('parser exceptions propagate instead of producing a partial PASS', () => {
  assert.throws(() => publicCallSites('SELECT public.unclosed('), /Unclosed parenthesis/u);
});

test('a failed build cannot replace an existing evidence set', () => {
  const root = temporaryDirectory('phase5-atomic-output');
  const output = join(root, 'evidence');
  try {
    mkdirSync(output);
    writeFileSync(join(output, 'sentinel.txt'), 'OLD-COMPLETE-EVIDENCE\n', 'utf8');
    assert.throws(() => buildAndPublish({ buildFunction: () => { throw new Error('synthetic parser failure'); }, outputDirectory: output }), /synthetic parser failure/u);
    assert.equal(readFileSync(join(output, 'sentinel.txt'), 'utf8'), 'OLD-COMPLETE-EVIDENCE\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an ALTER FUNCTION unknown suffix blocks artifact publication', () => {
  const root = temporaryDirectory('phase5-alter-publication-block');
  const output = join(root, 'evidence');
  try {
    mkdirSync(output);
    writeFileSync(join(output, 'sentinel.txt'), 'OLD-COMPLETE-EVIDENCE\n', 'utf8');
    assert.throws(() => buildAndPublish({
      buildFunction: () => {
        functionEvents([{ filename: '001_fixture.sql', source: `
          CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
          ALTER FUNCTION public.f() SECURITY INVOKER UNKNOWN_SUFFIX;
        ` }]);
        throw new Error('unreachable');
      },
      outputDirectory: output,
    }), /Unsupported ALTER FUNCTION form/u);
    assert.equal(readFileSync(join(output, 'sentinel.txt'), 'utf8'), 'OLD-COMPLETE-EVIDENCE\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('JSON and CSV ledgers are semantically equivalent', () => {
  const rows = [{ name: 'a', values: ['x', 'y'], nested: { z: 1 }, nullable: null }];
  const csv = 'name,values,nested,nullable\na,"[""x"",""y""]","{""z"":1}",\n';
  assert.doesNotThrow(() => assertJsonCsvSemanticEquivalence(rows, csv, Object.keys(rows[0]), 'fixture'));
});

test('full source evidence rebuild is deterministic including the owner ledger', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const first = createArtifactSet(build(root));
  const second = createArtifactSet(build(root));
  assert.equal(first.manifest.combined_evidence_hash, second.manifest.combined_evidence_hash);
  assert.equal(first.manifestContent, second.manifestContent);
  assert.equal(first.artifacts.get('phase5_security_definer_owner_ledger.json'), second.artifacts.get('phase5_security_definer_owner_ledger.json'));
});

test('CLI exits non-zero and never reports PASS for missing roots, migrations, or parser failure', () => {
  const root = temporaryDirectory('phase5-cli-fail-closed');
  const builder = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'build-phase5-authority-ledger.mjs');
  const paths = ['src/a.ts', 'customer-web/src/a.ts', 'supabase/functions/a.ts', 'scripts/a.mjs', 'supabase/migrations/001_fixture.sql'];
  const invoke = () => spawnSync(process.execPath, [builder], {
    encoding: 'utf8',
    env: { ...process.env, PHASE5_EVIDENCE_REPOSITORY_ROOT: root, PHASE5_EVIDENCE_OUTPUT_DIRECTORY: join(root, 'out') },
  });
  try {
    for (const path of paths) write(root, path, 'SELECT 1;');
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    assert.equal(spawnSync('git', ['add', '--all'], { cwd: root }).status, 0);

    rmSync(join(root, 'src'), { recursive: true, force: true });
    let result = invoke();
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /self_validation[\s\S]*PASS/iu);
    assert.equal(spawnSync('git', ['checkout', '--', 'src/a.ts'], { cwd: root }).status, 0);

    rmSync(join(root, 'supabase', 'migrations', '001_fixture.sql'));
    result = invoke();
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /self_validation[\s\S]*PASS/iu);
    assert.equal(spawnSync('git', ['checkout', '--', 'supabase/migrations/001_fixture.sql'], { cwd: root }).status, 0);

    write(root, 'supabase/migrations/001_fixture.sql', 'CREATE FUNCTION public.bad(');
    result = invoke();
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /self_validation[\s\S]*PASS/iu);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
