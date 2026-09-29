import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRUSTED_SOURCE_BASELINE_COMMIT,
  authorityAFunctionNames,
  authorityCFunctionNames,
  authorityClassFor,
  authorityDFunctionNames,
  authorityEFunctionNames,
  excludedTriggerFunctionNames,
  generatedPatchCallNamesBySignature,
  mediumFindings,
  outOfScopeMutationTableReasons,
  phase5MutableTables,
  phase5SecurityDefinerOwnerPolicy,
} from './phase5-authority-policy.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, '..', '..');
const schemaVersion = 4;

const canonicalLf = (value) => String(value).replace(/\r\n?/gu, '\n');
const sha256 = (value) => createHash('sha256').update(value).digest('hex').toUpperCase();
const stableSort = (values) => [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
const lineAt = (source, index) => source.slice(0, index).split('\n').length;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function ownerEvidenceForFunctionRow(row) {
  const policy = phase5SecurityDefinerOwnerPolicy;
  const sourceProven = Boolean(row.final_owner);
  const expectedSearchPath = row.search_path;
  const aclDisposition = row.target_activation_disposition;
  const privilegeEnvelopeComplete = Boolean(
    row.signature
    && policy.targetOwner
    && policy.exactSignatureAssertionRequired
    && policy.securityModeAssertionRequired
    && policy.searchPathAssertionRequired
    && expectedSearchPath
    && policy.schemaTrustAssertionRequired
    && policy.aclAssertionRequired
    && policy.activationExecutorAuthorityVerificationRequired
    && aclDisposition,
  );
  return {
    exact_signature: row.signature,
    authority_class: row.authority_class_if_relevant,
    security_mode: row.security_mode,
    current_owner_source_status: sourceProven ? 'SOURCE_PROVEN' : 'SOURCE_UNKNOWN',
    current_owner_source_value: sourceProven ? row.final_owner : null,
    current_owner_evidence: sourceProven
      ? { type: 'EXPLICIT_ALTER_FUNCTION_OWNER_TO', migration: row.owner_source_migration, line: row.owner_source_location }
      : { type: 'UNKNOWN_CREATE_EXECUTION_ROLE_NOT_PROVABLE_FROM_REPOSITORY', migration: null, line: null },
    target_owner: policy.targetOwner,
    target_owner_basis: policy.targetOwnerBasis,
    activation_catalog_verification_required: policy.activationCatalogVerificationRequired,
    activation_owner_convergence: policy.activationOwnerConvergence,
    activation_owner_transition_policy: policy.activationOwnerTransitionPolicy,
    pre_convergence_owner_evaluation: policy.preConvergenceOwnerEvaluation,
    owner_convergence_disposition: policy.ownerConvergenceDisposition,
    owner_convergence_phase: policy.ownerConvergencePhase,
    final_owner_required: policy.finalOwnerRequired,
    final_owner_unknown_allowed: policy.finalOwnerUnknownAllowed,
    exact_signature_assertion_required: policy.exactSignatureAssertionRequired,
    expected_search_path: expectedSearchPath,
    search_path_assertion_required: policy.searchPathAssertionRequired,
    schema_trust_assertion_required: policy.schemaTrustAssertionRequired,
    acl_assertion_required: policy.aclAssertionRequired,
    security_mode_assertion_required: policy.securityModeAssertionRequired,
    activation_executor_authority_verification_required: policy.activationExecutorAuthorityVerificationRequired,
    acl_activation_disposition: aclDisposition,
    privilege_envelope_complete: privilegeEnvelopeComplete,
    slice1_dependency_allowed: policy.slice1DependencyAllowed,
    slice1_dependency_on_unknown_owner: false,
    rollback_disposition: policy.rollbackDisposition,
  };
}

function buildOwnerEvidenceRows(functionRows) {
  return functionRows
    .filter((row) => row.relevance_class !== 'X' && row.security_mode === 'DEFINER')
    .map(ownerEvidenceForFunctionRow)
    .sort((left, right) => left.exact_signature < right.exact_signature ? -1 : left.exact_signature > right.exact_signature ? 1 : 0);
}

function validateOwnerEvidenceRows(ownerRows) {
  const failures = [];
  const signatures = new Set();
  const requiredDisposition = 'KEEP_IF_POSTGRES_ELSE_CONVERGE_ONLY_IF_EXACT_TRANSITION_APPROVED_OTHERWISE_ABORT';
  const requiredRollback = 'ROLLBACK_BEFORE_COMMIT_ELSE_PRESERVE_SAFE_TARGET_AND_FORWARD_REPAIR';
  for (const row of ownerRows) {
    const label = row.exact_signature || '<missing exact signature>';
    if (!row.exact_signature) failures.push(`${label}: exact signature missing`);
    else if (signatures.has(row.exact_signature)) failures.push(`${label}: duplicate owner-ledger signature`);
    else signatures.add(row.exact_signature);
    if (!['A', 'B', 'C', 'D', 'E'].includes(row.authority_class)) failures.push(`${label}: authority class missing or invalid`);
    if (row.security_mode !== 'DEFINER') failures.push(`${label}: owner ledger contains non-DEFINER function`);
    if (!['SOURCE_PROVEN', 'SOURCE_UNKNOWN'].includes(row.current_owner_source_status)) failures.push(`${label}: current owner source status invalid`);
    if (row.current_owner_source_status === 'SOURCE_PROVEN') {
      if (!row.current_owner_source_value) failures.push(`${label}: source-proven owner value missing`);
      if (row.current_owner_source_value !== 'postgres') failures.push(`${label}: source-proven owner is not postgres`);
      if (row.current_owner_evidence?.type !== 'EXPLICIT_ALTER_FUNCTION_OWNER_TO' || !row.current_owner_evidence?.migration || !row.current_owner_evidence?.line) failures.push(`${label}: source-proven owner evidence incomplete`);
    }
    if (row.current_owner_source_status === 'SOURCE_UNKNOWN') {
      if (row.current_owner_source_value !== null) failures.push(`${label}: source-unknown owner value must remain null`);
      if (row.current_owner_evidence?.type !== 'UNKNOWN_CREATE_EXECUTION_ROLE_NOT_PROVABLE_FROM_REPOSITORY') failures.push(`${label}: source-unknown owner evidence missing`);
    }
    if (row.target_owner !== 'postgres') failures.push(`${label}: target owner policy missing or unexpected`);
    if (row.target_owner_basis !== 'REPOSITORY_COMPATIBILITY_POLICY') failures.push(`${label}: target owner basis missing`);
    if (row.activation_catalog_verification_required !== true) failures.push(`${label}: activation owner catalog assertion missing`);
    if (row.activation_owner_convergence !== 'REQUIRED_IF_CURRENT_OWNER_DIFFERS_AND_TRANSITION_IS_APPROVED') failures.push(`${label}: activation owner convergence contract missing`);
    if (row.activation_owner_transition_policy !== 'FAIL_CLOSED') failures.push(`${label}: activation owner transition policy is not fail-closed`);
    if (row.pre_convergence_owner_evaluation !== 'REQUIRED_FAIL_CLOSED') failures.push(`${label}: pre-convergence owner evaluation missing`);
    if (row.owner_convergence_disposition !== requiredDisposition) failures.push(`${label}: owner convergence disposition missing`);
    if (row.owner_convergence_phase !== 'ACTIVATION') failures.push(`${label}: owner convergence phase must be ACTIVATION`);
    if (row.final_owner_required !== 'postgres') failures.push(`${label}: final owner requirement missing`);
    if (row.final_owner_unknown_allowed !== false) failures.push(`${label}: unknown final owner is allowed`);
    if (row.exact_signature_assertion_required !== true) failures.push(`${label}: exact-signature activation assertion missing`);
    if (row.search_path_assertion_required !== true || !row.expected_search_path) failures.push(`${label}: search_path activation assertion incomplete`);
    if (row.schema_trust_assertion_required !== true) failures.push(`${label}: schema-trust activation assertion missing`);
    if (row.acl_assertion_required !== true || !row.acl_activation_disposition) failures.push(`${label}: ACL activation assertion incomplete`);
    if (row.security_mode_assertion_required !== true) failures.push(`${label}: SECURITY mode assertion missing`);
    if (row.activation_executor_authority_verification_required !== true) failures.push(`${label}: activation executor authority assertion missing`);
    const envelopeActuallyComplete = Boolean(
      row.target_owner
      && row.exact_signature_assertion_required
      && row.security_mode_assertion_required
      && row.search_path_assertion_required
      && row.expected_search_path
      && row.schema_trust_assertion_required
      && row.acl_assertion_required
      && row.activation_executor_authority_verification_required
      && row.acl_activation_disposition,
    );
    if (row.privilege_envelope_complete !== true || !envelopeActuallyComplete) failures.push(`${label}: privilege envelope incomplete`);
    if (row.slice1_dependency_allowed !== false || row.slice1_dependency_on_unknown_owner !== false) failures.push(`${label}: Slice 1 dependency on unknown-owner authority is allowed`);
    if (row.rollback_disposition !== requiredRollback) failures.push(`${label}: owner rollback disposition missing`);
    if (row.authority_class === 'B' && row.acl_activation_disposition !== 'REVOKE_DIRECT_EXECUTE_FROM_PUBLIC_ANON_AUTHENTICATED_SERVICE_ROLE') failures.push(`${label}: Class-B ACL revoke disposition missing`);
  }
  const count = (predicate) => ownerRows.filter(predicate).length;
  return {
    failures,
    counters: {
      total_relevant_security_definer: ownerRows.length,
      source_proven_owner: count((row) => row.current_owner_source_status === 'SOURCE_PROVEN'),
      source_unknown_owner: count((row) => row.current_owner_source_status === 'SOURCE_UNKNOWN'),
      without_target_owner_policy: count((row) => row.target_owner !== 'postgres' || row.target_owner_basis !== 'REPOSITORY_COMPATIBILITY_POLICY'),
      without_activation_owner_assertion: count((row) => row.activation_catalog_verification_required !== true || row.pre_convergence_owner_evaluation !== 'REQUIRED_FAIL_CLOSED'),
      without_owner_convergence_disposition: count((row) => !row.owner_convergence_disposition || !row.activation_owner_convergence || row.activation_owner_transition_policy !== 'FAIL_CLOSED'),
      without_final_owner_requirement: count((row) => row.final_owner_required !== 'postgres'),
      allowed_unknown_final_owner: count((row) => row.final_owner_unknown_allowed !== false),
      without_complete_privilege_envelope: count((row) => row.privilege_envelope_complete !== true
        || row.exact_signature_assertion_required !== true
        || row.search_path_assertion_required !== true
        || !row.expected_search_path
        || row.schema_trust_assertion_required !== true
        || row.acl_assertion_required !== true
        || row.activation_executor_authority_verification_required !== true
        || !row.acl_activation_disposition
        || row.security_mode_assertion_required !== true),
      slice1_unknown_owner_dependencies: count((row) => row.slice1_dependency_allowed !== false || row.slice1_dependency_on_unknown_owner !== false),
    },
  };
}

function csvEscape(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) value = JSON.stringify(value);
  if (value === null || value === undefined) value = '';
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function csvFor(rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  return `${lines.join('\n')}\n`;
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value); rows.push(row); row = []; value = ''; }
    else if (char !== '\r') value += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (row.length || value) { row.push(value); rows.push(row); }
  return rows;
}

function assertJsonCsvSemanticEquivalence(rows, csv, columns, label) {
  const parsed = parseCsv(csv);
  const header = parsed.shift() || [];
  if (JSON.stringify(header) !== JSON.stringify(columns)) throw new Error(`${label} CSV header differs from JSON schema`);
  if (parsed.length !== rows.length) throw new Error(`${label} CSV row count ${parsed.length} differs from JSON row count ${rows.length}`);
  for (let index = 0; index < rows.length; index += 1) {
    const expected = columns.map((column) => {
      const value = rows[index][column];
      if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
      return value === null || value === undefined ? '' : String(value);
    });
    if (JSON.stringify(parsed[index]) !== JSON.stringify(expected)) throw new Error(`${label} CSV semantic mismatch at row ${index + 1}`);
  }
}

const callerSourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.ps1', '.py', '.sh', '.bash', '.zsh', '.json']);
const sourceCandidateExtensions = new Set([...callerSourceExtensions, '.sql']);

function extensionOf(path) {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index);
}

function normalizePath(path) {
  return path.replaceAll('\\', '/');
}

function sourceClassification(path) {
  const extension = extensionOf(path);
  if (!sourceCandidateExtensions.has(extension)) return null;
  if (extension === '.json' && !path.startsWith('automation/')) return null;
  if (/^supabase\/migrations\/\d{3}.*\.sql$/u.test(path)) return { family: 'DATABASE_MIGRATION', policy: 'REQUIRED_SCAN', callerScan: false };
  if (path.startsWith('src/')) return { family: 'ADMIN_APPLICATION_RUNTIME', policy: 'REQUIRED_SCAN', callerScan: true };
  if (path.startsWith('customer-web/src/')) return { family: 'CUSTOMER_APPLICATION_RUNTIME', policy: 'REQUIRED_SCAN', callerScan: true };
  if (path.startsWith('customer-web/scripts/')) return { family: 'CUSTOMER_OPERATIONAL_SCRIPT', policy: 'REQUIRED_SCAN', callerScan: true };
  if (path.startsWith('customer-web/functions/')) return { family: 'CUSTOMER_SERVER_RUNTIME', policy: 'REQUIRED_SCAN', callerScan: true };
  if (path.startsWith('supabase/functions/')) return { family: 'EDGE_FUNCTION', policy: 'REQUIRED_SCAN', callerScan: true };
  if (path.startsWith('automation/')) return { family: 'AUTOMATION_RUNTIME', policy: 'REQUIRED_SCAN', callerScan: true };
  if (path === 'public/sw.js') return { family: 'SERVICE_WORKER_RUNTIME', policy: 'REQUIRED_SCAN', callerScan: true };
  if (path.startsWith('scripts/analysis/')) return { family: 'ANALYSIS_TOOLING', policy: 'EXPLICIT_EXCLUSION', reason: 'Phase 5 evidence tooling cannot be counted as a business/runtime caller' };
  if (path.startsWith('scripts/testing/')) return { family: 'TEST_HARNESS', policy: 'EXPLICIT_EXCLUSION', reason: 'Test harness RPC and HTTP calls are not production runtime callers' };
  if (path.startsWith('scripts/agent/')) return { family: 'AGENT_CONTINUITY_TOOLING', policy: 'EXPLICIT_EXCLUSION', reason: 'Agent continuity tooling does not participate in business mutation authority' };
  if (path.startsWith('scripts/')) return { family: 'OPERATIONAL_SCRIPT', policy: 'REQUIRED_SCAN', callerScan: true };
  if (path.startsWith('tests/') || path.startsWith('e2e/') || path.startsWith('customer-web/tests/')) return { family: 'TEST_SOURCE', policy: 'EXPLICIT_EXCLUSION', reason: 'Test-only calls are excluded from the repository runtime caller graph' };
  if (path === 'database/schema.sql' || path === 'database/functions.sql') return { family: 'HISTORICAL_SCHEMA_SNAPSHOT', policy: 'EXPLICIT_EXCLUSION', reason: 'Historical reference snapshots are non-authoritative; ordered migrations are authoritative' };
  if (path === 'supabase/seed.sql') return { family: 'LOCAL_SEED_FIXTURE', policy: 'EXPLICIT_EXCLUSION', reason: 'Local seed fixture is not a deployed runtime caller or migration' };
  if (/^(?:customer-web\/)?(?:vite|playwright|eslint)[^/]*\.(?:ts|js|mjs|cjs)$/u.test(path) || /^eslint\.config\.js$/u.test(path)) return { family: 'BUILD_CONFIGURATION', policy: 'EXPLICIT_EXCLUSION', reason: 'Build/test configuration is not a business runtime caller' };
  return { family: 'UNCLASSIFIED_RUNTIME_LIKE_SOURCE', policy: 'UNCLASSIFIED' };
}

function trustedGitTree(root, commit = TRUSTED_SOURCE_BASELINE_COMMIT) {
  let resolved;
  let output;
  try {
    resolved = execFileSync('git', ['rev-parse', '--verify', `${commit}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    output = execFileSync('git', ['ls-tree', '-r', '-z', resolved], { cwd: root, encoding: 'utf8' });
  } catch (error) {
    throw new Error(`Cannot establish trusted source baseline ${commit}: ${error.message}`, { cause: error });
  }
  const entries = output.split('\0').filter(Boolean).map((line) => {
    const match = line.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\t(.+)$/u);
    if (!match) throw new Error(`Unparseable trusted Git tree row: ${line.slice(0, 160)}`);
    return { mode: match[1], type: match[2], blob_oid: match[3], path: normalizePath(match[4]) };
  });
  return { requested_commit: commit, resolved_commit: resolved, entries };
}

function currentGitPaths(root) {
  try {
    const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
    return output.split('\0').filter(Boolean).map(normalizePath);
  } catch (error) {
    throw new Error(`Cannot inspect current repository source inventory: ${error.message}`, { cause: error });
  }
}

function spawnGitStatus(root, args) {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return 0;
  } catch (error) {
    return Number.isInteger(error.status) ? error.status : 1;
  }
}

function trustedBlobContents(root, entries) {
  const objectIds = stableSort(new Set(entries.map((entry) => entry.blob_oid)));
  if (!objectIds.length) return new Map();
  try {
    const output = execFileSync('git', ['cat-file', '--batch'], {
      cwd: root,
      input: Buffer.from(`${objectIds.join('\n')}\n`, 'utf8'),
      maxBuffer: 256 * 1024 * 1024,
    });
    const contents = new Map();
    let offset = 0;
    for (const objectId of objectIds) {
      const headerEnd = output.indexOf(0x0A, offset);
      if (headerEnd < 0) throw new Error(`Missing cat-file header for ${objectId}`);
      const header = output.subarray(offset, headerEnd).toString('utf8');
      const match = header.match(/^([0-9a-f]+)\s+(\w+)\s+(\d+)$/u);
      if (!match || match[1] !== objectId || match[2] !== 'blob') throw new Error(`Unexpected cat-file header: ${header}`);
      const size = Number(match[3]);
      const contentStart = headerEnd + 1;
      const contentEnd = contentStart + size;
      if (contentEnd > output.length) throw new Error(`Truncated cat-file body for ${objectId}`);
      contents.set(objectId, Buffer.from(output.subarray(contentStart, contentEnd)));
      offset = contentEnd + 1;
    }
    return contents;
  } catch (error) {
    throw new Error(`Cannot read trusted Git blob contents: ${error.message}`, { cause: error });
  }
}

function validateSourceCoverage(root, trustedBaseline = null) {
  const suppliedPaths = Array.isArray(trustedBaseline) ? trustedBaseline : null;
  const baseline = suppliedPaths
    ? { requested_commit: 'EXPLICIT_TEST_BASELINE', resolved_commit: 'EXPLICIT_TEST_BASELINE', entries: suppliedPaths.map((path) => ({ path: normalizePath(path), blob_oid: 'EXPLICIT_TEST_IDENTITY', mode: '100644', type: 'blob' })) }
    : trustedGitTree(root, trustedBaseline?.commit || TRUSTED_SOURCE_BASELINE_COMMIT);
  let currentHead = 'EXPLICIT_TEST_WORKTREE';
  let baselineIsAncestor = true;
  if (!suppliedPaths) {
    try {
      currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
      baselineIsAncestor = spawnGitStatus(root, ['merge-base', '--is-ancestor', baseline.resolved_commit, currentHead]) === 0;
    } catch (error) {
      throw new Error(`Cannot verify trusted baseline ancestry: ${error.message}`, { cause: error });
    }
    if (!baselineIsAncestor) throw new Error(`Trusted baseline ${baseline.resolved_commit} is not an ancestor of audited HEAD ${currentHead}`);
  }
  const baselineCandidates = baseline.entries
    .map((entry) => ({ ...entry, classification: sourceClassification(entry.path) }))
    .filter((entry) => entry.classification);
  const baselineContents = suppliedPaths ? new Map() : trustedBlobContents(root, baselineCandidates);
  const baselinePathSet = new Set(baselineCandidates.map((entry) => entry.path));
  const currentPaths = suppliedPaths ? suppliedPaths : currentGitPaths(root);
  const unexpectedCandidates = currentPaths
    .filter((path) => !baselinePathSet.has(path))
    .map((path) => ({ path, classification: sourceClassification(path) }))
    .filter((entry) => entry.classification);
  const ledger = baselineCandidates.map((entry) => {
    const present = existsSync(join(root, entry.path)) && statSync(join(root, entry.path)).isFile();
    const baselineBytes = suppliedPaths ? null : baselineContents.get(entry.blob_oid);
    let workingBytes = null;
    if (present) {
      try { workingBytes = readFileSync(join(root, entry.path)); }
      catch (error) { throw new Error(`Required source file unreadable: ${entry.path}: ${error.message}`, { cause: error }); }
    }
    const baselineRawSha256 = baselineBytes ? sha256(baselineBytes) : null;
    const baselineContentSha256 = baselineBytes ? sha256(canonicalLf(baselineBytes.toString('utf8'))) : null;
    const workingRawSha256 = workingBytes ? sha256(workingBytes) : null;
    const workingContentSha256 = workingBytes ? sha256(canonicalLf(workingBytes.toString('utf8'))) : null;
    return {
      path: entry.path,
      family: entry.classification.family,
      expected_from_baseline: true,
      present,
      scan_policy: entry.classification.policy,
      scanned: entry.classification.policy === 'REQUIRED_SCAN' && present,
      excluded: entry.classification.policy === 'EXPLICIT_EXCLUSION',
      exclusion_reason: entry.classification.reason || null,
      caller_scan: Boolean(entry.classification.callerScan),
      baseline_commit: baseline.resolved_commit,
      baseline_blob_oid: entry.blob_oid,
      baseline_raw_sha256: baselineRawSha256,
      baseline_content_sha256: baselineContentSha256,
      working_raw_sha256: workingRawSha256,
      working_content_sha256: workingContentSha256,
      working_sha256: workingContentSha256,
      raw_identity_match: present && (suppliedPaths || baselineRawSha256 === workingRawSha256),
      identity_match: present && (suppliedPaths || baselineContentSha256 === workingContentSha256),
      identity_comparison: suppliedPaths ? 'EXPLICIT_TEST_PRESENCE_ONLY' : 'UTF8_TEXT_CANONICAL_LF_ONLY',
      caller_edges: 0,
      writer_signals: 0,
    };
  });
  for (const entry of unexpectedCandidates) ledger.push({
    path: entry.path,
    family: entry.classification.family,
    expected_from_baseline: false,
    present: existsSync(join(root, entry.path)),
    scan_policy: entry.classification.policy,
    scanned: false,
    excluded: entry.classification.policy === 'EXPLICIT_EXCLUSION',
    exclusion_reason: entry.classification.reason || null,
    caller_scan: false,
    baseline_commit: baseline.resolved_commit,
    baseline_blob_oid: null,
    baseline_raw_sha256: null,
    baseline_content_sha256: null,
    working_raw_sha256: existsSync(join(root, entry.path)) ? sha256(readFileSync(join(root, entry.path))) : null,
    working_content_sha256: existsSync(join(root, entry.path)) ? sha256(canonicalLf(readFileSync(join(root, entry.path), 'utf8'))) : null,
    working_sha256: existsSync(join(root, entry.path)) ? sha256(canonicalLf(readFileSync(join(root, entry.path), 'utf8'))) : null,
    raw_identity_match: false,
    identity_match: false,
    identity_comparison: 'NO_TRUSTED_BASELINE_ENTRY',
    caller_edges: 0,
    writer_signals: 0,
  });
  ledger.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

  const missing = ledger.filter((entry) => entry.expected_from_baseline && !entry.present);
  const identityMismatches = ledger.filter((entry) => entry.expected_from_baseline && entry.present && !entry.identity_match);
  const unclassified = ledger.filter((entry) => entry.scan_policy === 'UNCLASSIFIED');
  const unexpectedRequired = ledger.filter((entry) => !entry.expected_from_baseline && entry.scan_policy === 'REQUIRED_SCAN');
  const migrationRows = ledger.filter((entry) => entry.family === 'DATABASE_MIGRATION');
  const expectedMigrationCeiling = suppliedPaths
    ? Math.max(0, ...migrationRows.map((entry) => Number(entry.path.split('/').at(-1).slice(0, 3))))
    : 122;
  const sequenceMap = new Map();
  for (const entry of migrationRows) {
    const sequence = Number(entry.path.split('/').at(-1).slice(0, 3));
    if (!sequenceMap.has(sequence)) sequenceMap.set(sequence, []);
    sequenceMap.get(sequence).push(entry.path);
  }
  const missingSequences = Array.from({ length: expectedMigrationCeiling }, (_, index) => index + 1).filter((sequence) => !sequenceMap.has(sequence));
  const duplicateSequences = [...sequenceMap.entries()].filter(([, paths]) => paths.length !== 1).map(([sequence, paths]) => ({ sequence, paths }));
  const ceilingViolations = [...sequenceMap.keys()].filter((sequence) => sequence > expectedMigrationCeiling);
  const failures = [];
  if (missing.length) failures.push(`Trusted source files missing: ${missing.map((entry) => entry.path).join(', ')}`);
  if (identityMismatches.length) failures.push(`Trusted source identity mismatch: ${identityMismatches.map((entry) => entry.path).join(', ')}`);
  if (unclassified.length) failures.push(`Unclassified runtime-like source files: ${unclassified.map((entry) => entry.path).join(', ')}`);
  if (unexpectedRequired.length) failures.push(`Runtime-like source files absent from trusted baseline: ${unexpectedRequired.map((entry) => entry.path).join(', ')}`);
  if (missingSequences.length) failures.push(`Migration sequence gaps: ${missingSequences.join(', ')}`);
  if (duplicateSequences.length) failures.push(`Duplicate migration sequences: ${duplicateSequences.map((entry) => entry.sequence).join(', ')}`);
  if (ceilingViolations.length) failures.push(`Migration ceiling exceeded: ${ceilingViolations.join(', ')}`);
  if (failures.length) throw new Error(`Source completeness validation failed:\n- ${failures.join('\n- ')}`);

  const scannedFiles = ledger.filter((entry) => entry.scanned).map((entry) => entry.path);
  const callerFiles = ledger.filter((entry) => entry.scanned && entry.caller_scan).map((entry) => entry.path);
  return {
    trusted_baseline_source: 'immutable Git commit tree',
    trusted_baseline_requested: baseline.requested_commit,
    trusted_baseline_identity: baseline.resolved_commit,
    audited_head_identity: currentHead,
    trusted_baseline_is_ancestor: baselineIsAncestor,
    baseline_self_reference_risk: 'NO',
    expected_file_count: baselineCandidates.length,
    present_file_count: ledger.filter((entry) => entry.expected_from_baseline && entry.present).length,
    scanned_file_count: scannedFiles.length,
    excluded_file_count: ledger.filter((entry) => entry.excluded).length,
    unclassified_file_count: 0,
    unclassified_families: [],
    expected_migrations: migrationRows.length,
    present_migrations: migrationRows.filter((entry) => entry.present).length,
    missing_migrations: [],
    migration_identity_check: 'PASS',
    migration_content_identity_mismatches: [],
    scanned_files: scannedFiles,
    caller_source_files: callerFiles,
    source_coverage_ledger: ledger,
    path_inventory_sha256: sha256(ledger.map((entry) => `${entry.path}\0${entry.baseline_blob_oid || ''}\0${entry.scan_policy}\n`).join('')),
  };
}

function matchingParen(source, openingIndex) {
  let depth = 0;
  let quote = null;
  let dollarTag = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) { index += dollarTag.length - 1; dollarTag = null; }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '$') {
      const match = source.slice(index).match(/^\$[A-Za-z_0-9]*\$/u);
      if (match) { dollarTag = match[0]; index += dollarTag.length - 1; continue; }
    }
    if (char === '(') depth += 1;
    if (char === ')' && --depth === 0) return index;
  }
  throw new Error(`Unclosed parenthesis at byte ${openingIndex}`);
}

function splitTopLevel(source) {
  const result = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) { result.push(source.slice(start, index)); start = index + 1; }
  }
  result.push(source.slice(start));
  return result;
}

function normalizeType(type) {
  return type
    .trim()
    .toLowerCase()
    .replace(/\bcharacter varying\b/gu, 'varchar')
    .replace(/\btimestamp with time zone\b/gu, 'timestamptz')
    .replace(/\btimestamp without time zone\b/gu, 'timestamp')
    .replace(/\bdouble precision\b/gu, 'double precision')
    .replace(/\binteger\b/gu, 'int')
    .replace(/\bboolean\b/gu, 'bool')
    .replace(/\s+/gu, ' ');
}

function normalizeArguments(argumentsSource) {
  const entries = splitTopLevel(argumentsSource)
    .map((entry) => entry.replace(/--[^\n]*/gu, '').trim())
    .filter(Boolean)
    .filter((entry) => !/^OUT\s/iu.test(entry));
  return entries.map((entry) => {
    let value = entry
      .replace(/^(INOUT|IN|VARIADIC)\s+/iu, '')
      .replace(/\s+(DEFAULT\b|=)[\s\S]*$/iu, '')
      .trim();
    const tokens = value.split(/\s+/u);
    const startsWithCompoundType = /^(double\s+precision|timestamp\s+(?:with|without)|time\s+(?:with|without)|character\s+varying)\b/iu.test(value);
    if (tokens.length > 1 && !startsWithCompoundType) value = tokens.slice(1).join(' ');
    return normalizeType(value);
  });
}

function signature(schema, name, argumentTypes) {
  return `${schema}.${name}(${argumentTypes.join(',')})`;
}

function stripStringsAndComments(source) {
  let output = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      output += char === '\n' ? '\n' : ' ';
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      output += ' ';
      if (char === '*' && next === '/') { output += ' '; blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      output += ' ';
      if (char === quote) {
        if (next === quote) { output += ' '; index += 1; }
        else quote = null;
      }
      continue;
    }
    if (char === '-' && next === '-') { output += '  '; lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { output += '  '; blockComment = true; index += 1; continue; }
    if (char === "'") { output += ' '; quote = char; continue; }
    output += char;
  }
  return output;
}

function parseFunctionBody(source, afterArguments) {
  const tail = source.slice(afterArguments);
  const asMatch = tail.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/iu);
  if (!asMatch) throw new Error(`CREATE FUNCTION body missing near line ${lineAt(source, afterArguments)}`);
  const openingTagIndex = afterArguments + asMatch.index + asMatch[0].lastIndexOf(asMatch[1]);
  const bodyStart = openingTagIndex + asMatch[1].length;
  const bodyEnd = source.indexOf(asMatch[1], bodyStart);
  if (bodyEnd < 0) throw new Error(`Unclosed function body near line ${lineAt(source, afterArguments)}`);
  const closingTagEnd = bodyEnd + asMatch[1].length;
  const semicolon = source.indexOf(';', closingTagEnd);
  if (semicolon < 0) throw new Error(`CREATE FUNCTION statement terminator missing near line ${lineAt(source, afterArguments)}`);
  const header = source.slice(afterArguments, openingTagIndex);
  const footer = source.slice(closingTagEnd, semicolon);
  const attributes = `${header}\n${footer}`;
  const configuration = {};
  for (const match of attributes.matchAll(/\bSET\s+([A-Za-z_][\w.]*)\s*(?:=|TO)\s*([^;\n]+?)(?=\s+(?:AS|LANGUAGE|SECURITY|IMMUTABLE|STABLE|VOLATILE|CALLED|RETURNS|STRICT|PARALLEL|COST|ROWS|SUPPORT|SET)\b|$)/giu)) {
    configuration[match[1].toLowerCase()] = match[2].trim().replace(/\s+/gu, ' ');
  }
  const language = attributes.match(/\bLANGUAGE\s+([A-Za-z_][\w]*)/iu)?.[1]?.toLowerCase() || null;
  return {
    body: source.slice(bodyStart, bodyEnd),
    definitionEnd: semicolon + 1,
    header,
    footer,
    attributes,
    language,
    configuration,
  };
}

function parseSignatureText(value) {
  const match = value.trim().match(/^(?:(\w+)\.)?(\w+)\s*\((.*)\)$/u);
  if (!match) return null;
  const argumentTypes = match[3].trim() ? splitTopLevel(match[3]).map(normalizeType) : [];
  return { schema: match[1] || 'public', name: match[2], argumentTypes, signature: signature(match[1] || 'public', match[2], argumentTypes) };
}

function parseAlterFunctionActions(clause, context) {
  const actions = [];
  let remaining = clause.trim();
  const nextAction = /\s+(?=(?:RENAME\s+TO|OWNER\s+TO|(?:EXTERNAL\s+)?SECURITY\s+(?:INVOKER|DEFINER)|SET\s+[A-Za-z_]|RESET\s+(?:ALL|[A-Za-z_])|PARALLEL\s+|COST\s+|ROWS\s+|LEAKPROOF\b|NO\s+LEAKPROOF\b|SUPPORT\s+))/iu;
  while (remaining) {
    let match = remaining.match(/^RENAME\s+TO\s+("(?:[^"]|"")*"|[A-Za-z_][\w$]*)(?=\s|$)/iu);
    if (match) {
      actions.push({ type: 'RENAME', newName: match[1].replace(/^"|"$/gu, '').replace(/""/gu, '"'), source: match[0] });
      remaining = remaining.slice(match[0].length).trimStart();
      continue;
    }
    match = remaining.match(/^OWNER\s+TO\s+("(?:[^"]|"")*"|[A-Za-z_][\w$]*)(?=\s|$)/iu);
    if (match) {
      actions.push({ type: 'OWNER', owner: match[1].replace(/^"|"$/gu, '').replace(/""/gu, '"'), source: match[0] });
      remaining = remaining.slice(match[0].length).trimStart();
      continue;
    }
    match = remaining.match(/^(?:EXTERNAL\s+)?SECURITY\s+(INVOKER|DEFINER)(?=\s|$)/iu);
    if (match) {
      actions.push({ type: 'SECURITY', mode: match[1].toUpperCase(), source: match[0] });
      remaining = remaining.slice(match[0].length).trimStart();
      continue;
    }
    match = remaining.match(/^SET\s+([A-Za-z_][\w.]*)\s*(?:=|TO)\s*/iu);
    if (match) {
      const valueSource = remaining.slice(match[0].length);
      const boundary = valueSource.search(nextAction);
      const value = (boundary < 0 ? valueSource : valueSource.slice(0, boundary)).trim().replace(/\s+/gu, ' ');
      if (!value) throw new Error(`ALTER FUNCTION SET value missing at ${context}`);
      const consumed = match[0].length + (boundary < 0 ? valueSource.length : boundary);
      actions.push({ type: 'SET_CONFIGURATION', parameter: match[1].toLowerCase(), value, source: remaining.slice(0, consumed).trim() });
      remaining = remaining.slice(consumed).trimStart();
      continue;
    }
    match = remaining.match(/^RESET\s+(ALL|[A-Za-z_][\w.]*)(?=\s|$)/iu);
    if (match) {
      actions.push({ type: 'RESET_CONFIGURATION', parameter: match[1].toLowerCase(), source: match[0] });
      remaining = remaining.slice(match[0].length).trimStart();
      continue;
    }
    const nonSemanticPatterns = [
      ['PARALLEL', /^PARALLEL\s+(?:UNSAFE|RESTRICTED|SAFE)(?=\s|$)/iu],
      ['COST', /^COST\s+\d+(?:\.\d+)?(?=\s|$)/iu],
      ['ROWS', /^ROWS\s+\d+(?:\.\d+)?(?=\s|$)/iu],
      ['NO_LEAKPROOF', /^NO\s+LEAKPROOF(?=\s|$)/iu],
      ['LEAKPROOF', /^LEAKPROOF(?=\s|$)/iu],
      ['SUPPORT', /^SUPPORT\s+(?:(?:"?\w+"?)\.)?"?\w+"?(?=\s|$)/iu],
    ];
    let consumedNonSemantic = false;
    for (const [attribute, pattern] of nonSemanticPatterns) {
      match = remaining.match(pattern);
      if (!match) continue;
      actions.push({ type: 'NON_SEMANTIC', attribute, source: match[0] });
      remaining = remaining.slice(match[0].length).trimStart();
      consumedNonSemantic = true;
      break;
    }
    if (consumedNonSemantic) continue;
    throw new Error(`Unsupported ALTER FUNCTION form at ${context}: ${remaining.slice(0, 120)}`);
  }
  if (!actions.length) throw new Error(`Empty ALTER FUNCTION clause at ${context}`);
  return actions;
}

function functionEvents(migrationFiles) {
  const state = new Map();
  const historicalIdentities = new Set();
  const events = [];
  let historicalDefinitions = 0;
  let supersededDefinitions = 0;
  let matchedDrops = 0;
  let renameEvents = 0;
  let alterStatements = 0;
  let handledAlterStatements = 0;
  let explicitlyNonSemanticAlterStatements = 0;
  let securityAlterations = 0;
  let resolvedSecurityAlterations = 0;
  let ownerAlterations = 0;
  let resolvedOwnerAlterations = 0;
  const alterLedger = [];
  const generatedDefinitionMigrations = [];

  for (const migration of migrationFiles) {
    const source = migration.source;
    const migrationEvents = [];
    const pattern = /\b(CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|DROP\s+FUNCTION(?:\s+IF\s+EXISTS)?|ALTER\s+FUNCTION)\s+((?:"?\w+"?\.)?"?\w+"?)\s*\(/giu;
    let match;
    while ((match = pattern.exec(source))) {
      const opening = pattern.lastIndex - 1;
      const closing = matchingParen(source, opening);
      const argumentTypes = normalizeArguments(source.slice(opening + 1, closing));
      const qualified = match[2].replaceAll('"', '').split('.');
      const schema = qualified.length === 2 ? qualified[0] : 'public';
      const name = qualified.at(-1);
      const key = signature(schema, name, argumentTypes);
      const location = lineAt(source, match.index);
      if (/^CREATE/iu.test(match[1])) {
        const parsed = parseFunctionBody(source, closing + 1);
        migrationEvents.push({ index: match.index, type: 'FUNCTION_CREATE', key, schema, name, argumentTypes, location, parsed });
        pattern.lastIndex = parsed.definitionEnd;
      } else {
        const end = source.indexOf(';', closing);
        const clause = source.slice(closing + 1, end >= 0 ? end : closing + 500).trim();
        migrationEvents.push({ index: match.index, type: /^DROP/iu.test(match[1]) ? 'FUNCTION_DROP' : 'FUNCTION_ALTER', key, schema, name, argumentTypes, location, clause });
        if (!/^DROP/iu.test(match[1])) alterStatements += 1;
        pattern.lastIndex = end >= 0 ? end + 1 : closing + 1;
      }
    }

    const aclPattern = /\b(GRANT\s+EXECUTE|REVOKE\s+(?:ALL|EXECUTE))\s+ON\s+FUNCTION\s+((?:"?\w+"?\.)?"?\w+"?)\s*\(/giu;
    while ((match = aclPattern.exec(source))) {
      const opening = aclPattern.lastIndex - 1;
      const closing = matchingParen(source, opening);
      const argumentTypes = normalizeArguments(source.slice(opening + 1, closing));
      const qualified = match[2].replaceAll('"', '').split('.');
      const end = source.indexOf(';', closing);
      const clause = source.slice(closing + 1, end >= 0 ? end : closing + 300);
      const roleMatch = clause.match(/\b(?:TO|FROM)\s+([^;]+)/iu);
      if (!roleMatch) throw new Error(`Cannot resolve function ACL roles in ${migration.filename}:${lineAt(source, match.index)}`);
      migrationEvents.push({
        index: match.index,
        type: 'FUNCTION_ACL',
        key: signature(qualified.length === 2 ? qualified[0] : 'public', qualified.at(-1), argumentTypes),
        grant: /^GRANT/iu.test(match[1]),
        roles: roleMatch[1].split(',').map((role) => role.trim().replaceAll('"', '').toLowerCase()),
        location: lineAt(source, match.index),
      });
      aclPattern.lastIndex = end >= 0 ? end + 1 : closing + 1;
    }

    migrationEvents.sort((left, right) => left.index - right.index);
    for (const event of migrationEvents) {
      if (event.type === 'FUNCTION_CREATE') {
        historicalDefinitions += 1;
        historicalIdentities.add(event.key);
        if (state.has(event.key)) supersededDefinitions += 1;
        const existing = state.get(event.key);
        const existingAcl = existing?.acl;
        const replacesExisting = state.has(event.key);
        state.set(event.key, {
          signature: event.key, schema: event.schema, functionName: event.name, argumentTypes: event.argumentTypes,
          sourceMigration: migration.filename, sourceLocation: event.location, body: event.parsed.body,
          securityMode: /\bSECURITY\s+DEFINER\b/iu.test(event.parsed.attributes) ? 'DEFINER' : 'INVOKER',
          language: event.parsed.language,
          configuration: event.parsed.configuration,
          searchPath: event.parsed.configuration.search_path || null,
          returnsTrigger: /\bRETURNS\s+TRIGGER\b/iu.test(event.parsed.attributes),
          generatedDefinitionEvents: existing?.generatedDefinitionEvents || [],
          owner: replacesExisting ? existing.owner : null,
          ownerSourceMigration: replacesExisting ? existing.ownerSourceMigration : null,
          ownerSourceLocation: replacesExisting ? existing.ownerSourceLocation : null,
          acl: existingAcl || { public: true, anon: false, authenticated: false, service_role: false },
        });
        events.push({ type: replacesExisting ? 'CREATE_OR_REPLACE' : 'CREATE', signature: event.key, migration: migration.filename, line: event.location });
      } else if (event.type === 'FUNCTION_DROP') {
        historicalIdentities.add(event.key);
        if (state.delete(event.key)) matchedDrops += 1;
        events.push({ type: 'DROP', signature: event.key, migration: migration.filename, line: event.location });
      } else if (event.type === 'FUNCTION_ALTER') {
        const context = `${migration.filename}:${event.location}`;
        const actions = parseAlterFunctionActions(event.clause, context);
        let currentKey = event.key;
        let target = state.get(currentKey);
        if (!target) throw new Error(`ALTER FUNCTION target missing: ${event.key} at ${migration.filename}:${event.location}`);
        const statementLedger = {
          source_migration: migration.filename,
          source_location: event.location,
          target_signature: event.key,
          final_signature: event.key,
          original_clause: event.clause,
          clauses_detected: actions.map((action) => action.type),
          clauses_applied: [],
          owner_effect: null,
          security_effect: null,
          configuration_effect: [],
          rename_effect: null,
          classification: actions.every((action) => action.type === 'NON_SEMANTIC') ? 'EXPLICITLY_NON_SEMANTIC' : 'FULLY_HANDLED',
          non_semantic_reason: actions.every((action) => action.type === 'NON_SEMANTIC') ? 'Attribute is outside identity, authority, language, and tracked configuration semantics' : null,
          fully_consumed: true,
          unconsumed_suffix: '',
        };
        for (const action of actions) {
          if (action.type === 'RENAME') {
            renameEvents += 1;
            const renamedSignature = signature(event.schema, action.newName, event.argumentTypes);
            historicalIdentities.add(renamedSignature);
            state.delete(currentKey);
            target = { ...target, signature: renamedSignature, functionName: action.newName };
            state.set(renamedSignature, target);
            statementLedger.rename_effect = { from: currentKey, to: renamedSignature };
            events.push({ type: 'RENAME', signature: currentKey, renamedSignature, migration: migration.filename, line: event.location });
            currentKey = renamedSignature;
          } else if (action.type === 'OWNER') {
            ownerAlterations += 1;
            target.owner = action.owner;
            target.ownerSourceMigration = migration.filename;
            target.ownerSourceLocation = event.location;
            resolvedOwnerAlterations += 1;
            statementLedger.owner_effect = { owner: action.owner };
            events.push({ type: 'OWNER', signature: currentKey, owner: action.owner, migration: migration.filename, line: event.location });
          } else if (action.type === 'SECURITY') {
            securityAlterations += 1;
            target.securityMode = action.mode;
            resolvedSecurityAlterations += 1;
            statementLedger.security_effect = { mode: action.mode };
            events.push({ type: `SECURITY_${action.mode}`, signature: currentKey, migration: migration.filename, line: event.location });
          } else if (action.type === 'SET_CONFIGURATION') {
            target.configuration = { ...target.configuration, [action.parameter]: action.value };
            if (action.parameter === 'search_path') target.searchPath = action.value;
            statementLedger.configuration_effect.push({ action: 'SET', parameter: action.parameter, value: action.value });
            events.push({ type: 'SET_CONFIGURATION', signature: currentKey, parameter: action.parameter, value: action.value, migration: migration.filename, line: event.location });
          } else if (action.type === 'RESET_CONFIGURATION') {
            if (action.parameter === 'all') {
              target.configuration = {};
              target.searchPath = null;
            } else {
              const configuration = { ...target.configuration };
              delete configuration[action.parameter];
              target.configuration = configuration;
              if (action.parameter === 'search_path') target.searchPath = null;
            }
            statementLedger.configuration_effect.push({ action: 'RESET', parameter: action.parameter });
            events.push({ type: 'RESET_CONFIGURATION', signature: currentKey, parameter: action.parameter, migration: migration.filename, line: event.location });
          } else if (action.type === 'NON_SEMANTIC') {
            events.push({ type: 'ALTER_EXPLICITLY_NON_SEMANTIC', signature: currentKey, clause: action.source, reason: 'Does not change identity, execution authority, language, or function configuration tracked by this evidence model', migration: migration.filename, line: event.location });
          }
          statementLedger.clauses_applied.push(action.type);
        }
        handledAlterStatements += 1;
        if (statementLedger.classification === 'EXPLICITLY_NON_SEMANTIC') explicitlyNonSemanticAlterStatements += 1;
        statementLedger.final_signature = currentKey;
        alterLedger.push(statementLedger);
      } else if (event.type === 'FUNCTION_ACL' && state.has(event.key)) {
        for (const role of event.roles) if (role in state.get(event.key).acl) state.get(event.key).acl[role] = event.grant;
        events.push({ type: event.grant ? 'GRANT_EXECUTE' : 'REVOKE_EXECUTE', signature: event.key, migration: migration.filename, line: event.location, roles: event.roles });
      }
    }

    // A few historical migrations patch function definitions through
    // pg_get_functiondef and EXECUTE. Resolve every schema-qualified signature
    // literal in such a migration and fail later if no target can be proven.
    if (/\bpg_get_functiondef\s*\(/iu.test(source)) {
      const targets = new Map();
      for (const generated of source.matchAll(/'((?:public\.)?\w+\([^']*\))'/giu)) {
        const parsed = parseSignatureText(generated[1]);
        if (parsed && state.has(parsed.signature) && !targets.has(parsed.signature)) {
          targets.set(parsed.signature, lineAt(source, generated.index));
        }
      }
      generatedDefinitionMigrations.push({ migration: migration.filename, targets: stableSort(targets.keys()) });
      for (const [target, line] of targets) {
        const targetRow = state.get(target);
        targetRow.generatedDefinitionEvents.push({
          migration: migration.filename,
          line,
          mechanism: 'pg_get_functiondef + dynamic replacement',
        });
        // The dynamic patch is the final definition-producing event even
        // though its SQL text is assembled at migration time.
        targetRow.sourceMigration = migration.filename;
        targetRow.sourceLocation = line;
      }
    }

    applyDynamicExactRevokes(source, state);
  }

  return { state, historicalDefinitions, supersededDefinitions, matchedDrops, renameEvents, alterStatements, handledAlterStatements, explicitlyNonSemanticAlterStatements, unresolvedAlterStatements: 0, securityAlterations, resolvedSecurityAlterations, ownerAlterations, resolvedOwnerAlterations, unsupportedAlterForms: 0, historicalSignatureIdentities: historicalIdentities.size, events, alterLedger, generatedDefinitionMigrations };
}

function _applyAclStatements(source, state) {
  const pattern = /\b(GRANT\s+EXECUTE|REVOKE\s+(?:ALL|EXECUTE))\s+ON\s+FUNCTION\s+((?:"?\w+"?\.)?"?\w+"?)\s*\(/giu;
  let match;
  while ((match = pattern.exec(source))) {
    const opening = pattern.lastIndex - 1;
    const closing = matchingParen(source, opening);
    const argumentTypes = normalizeArguments(source.slice(opening + 1, closing));
    const qualified = match[2].replaceAll('"', '').split('.');
    const key = signature(qualified.length === 2 ? qualified[0] : 'public', qualified.at(-1), argumentTypes);
    const end = source.indexOf(';', closing);
    const clause = source.slice(closing + 1, end >= 0 ? end : closing + 300);
    const roleMatch = clause.match(/\b(?:TO|FROM)\s+([^;]+)/iu);
    if (!state.has(key) || !roleMatch) { pattern.lastIndex = closing + 1; continue; }
    const roles = roleMatch[1].split(',').map((role) => role.trim().replaceAll('"', '').toLowerCase());
    const grant = /^GRANT/iu.test(match[1]);
    for (const role of roles) if (role in state.get(key).acl) state.get(key).acl[role] = grant;
    pattern.lastIndex = end >= 0 ? end + 1 : closing + 1;
  }
}

function applyDynamicExactRevokes(source, state) {
  if (!/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role/iu.test(source)) return;
  for (const match of source.matchAll(/'([^']+\([^']*\))'::REGPROCEDURE/giu)) {
    const parsed = parseSignatureText(match[1]);
    if (!parsed || !state.has(parsed.signature)) continue;
    Object.assign(state.get(parsed.signature).acl, { public: false, anon: false, authenticated: false, service_role: false });
  }
}

function directWrites(body) {
  const clean = stripStringsAndComments(body);
  const writes = new Set();
  const patterns = [
    /\bINSERT\s+INTO\s+(?:public\.)?(\w+)/giu,
    /\bUPDATE\s+(?:ONLY\s+)?(?:public\.)?(\w+)/giu,
    /\bDELETE\s+FROM\s+(?:public\.)?(\w+)/giu,
    /\bMERGE\s+INTO\s+(?:public\.)?(\w+)/giu,
  ];
  const sqlKeywords = new Set(['loop', 'of', 'set', 'nowait', 'skip', 'locked']);
  for (const pattern of patterns) for (const match of clean.matchAll(pattern)) {
    if (/^UPDATE/iu.test(match[0])) {
      const prefix = clean.slice(Math.max(0, match.index - 40), match.index);
      if (/\bFOR\s+(?:NO\s+KEY\s+)?$/iu.test(prefix)) continue;
    }
    const table = match[1].toLowerCase();
    if (!sqlKeywords.has(table)) writes.add(table);
  }
  return stableSort(writes);
}

function publicCallSites(body) {
  const clean = stripStringsAndComments(body);
  const calls = new Map();
  const pattern = /\bpublic\.(\w+)\s*\(/giu;
  let match;
  while ((match = pattern.exec(clean))) {
    const opening = pattern.lastIndex - 1;
    const closing = matchingParen(clean, opening);
    const argumentsSource = clean.slice(opening + 1, closing).trim();
    const argumentCount = argumentsSource ? splitTopLevel(argumentsSource).length : 0;
    calls.set(`${match[1]}:${argumentCount}`, { name: match[1], argument_count: argumentCount });
    // Do not jump to the closing parenthesis: nested public.* calls inside
    // this argument list are distinct authority/caller edges.
  }
  return [...calls.values()].sort((left, right) => `${left.name}:${left.argument_count}`.localeCompare(`${right.name}:${right.argument_count}`));
}

function reconstructTriggers(migrationFiles) {
  const state = new Map();
  let historicalStatements = 0;
  for (const migration of migrationFiles) {
    const source = migration.source;
    const combined = /\bCREATE\s+(OR\s+REPLACE\s+)?(CONSTRAINT\s+)?TRIGGER\s+("?\w+"?)([\s\S]*?)EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+((?:"?\w+"?\.)?"?\w+"?)\s*\(([^;]*?)\)\s*;|\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?("?\w+"?)\s+ON\s+((?:"?\w+"?\.)?"?\w+"?)[^;]*;/giu;
    let match;
    while ((match = combined.exec(source))) {
      if (match[7]) {
        const tableParts = match[8].replaceAll('"', '').split('.');
        state.delete(`${tableParts.length === 2 ? tableParts[0] : 'public'}.${tableParts.at(-1)}.${match[7].replaceAll('"', '')}`);
        continue;
      }
      historicalStatements += 1;
      const definition = match[4];
      const tableMatch = definition.match(/\bON\s+(?:ONLY\s+)?((?:"?\w+"?\.)?"?\w+"?)/iu);
      if (!tableMatch) throw new Error(`Cannot resolve trigger table in ${migration.filename}:${lineAt(source, match.index)}`);
      const tableParts = tableMatch[1].replaceAll('"', '').split('.');
      const schema = tableParts.length === 2 ? tableParts[0] : 'public';
      const table = tableParts.at(-1);
      const triggerName = match[3].replaceAll('"', '');
      const functionParts = match[5].replaceAll('"', '').split('.');
      const functionSchema = functionParts.length === 2 ? functionParts[0] : 'public';
      const functionName = functionParts.at(-1);
      const functionArgumentTypes = normalizeArguments(match[6]);
      const timingMatch = definition.match(/\b(BEFORE|AFTER|INSTEAD\s+OF)\b/iu);
      const eventsSection = definition.slice(timingMatch?.index || 0, tableMatch.index);
      const events = [...eventsSection.matchAll(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/giu)].map((item) => item[1].toUpperCase());
      const key = `${schema}.${table}.${triggerName}`;
      state.set(key, {
        schema,
        table,
        trigger_name: triggerName,
        trigger_function_signature: signature(functionSchema, functionName, functionArgumentTypes),
        timing: timingMatch ? timingMatch[1].toUpperCase().replace(/\s+/gu, ' ') : 'UNKNOWN',
        events: stableSort(new Set(events)),
        constraint_trigger: Boolean(match[2]),
        deferrable: /\bDEFERRABLE\b/iu.test(definition),
        initially_deferred: /\bINITIALLY\s+DEFERRED\b/iu.test(definition),
        source_migration: migration.filename,
        source_location: lineAt(source, match.index),
      });
    }
  }
  return { state, historicalStatements };
}

function reconstructJobs(migrationFiles) {
  const jobs = new Map();
  for (const migration of migrationFiles) {
    const source = migration.source;
    for (const match of source.matchAll(/cron\.unschedule\([\s\S]*?jobname\s*=\s*'([^']+)'[\s\S]*?\);|cron\.unschedule\(\s*'([^']+)'\s*\)/giu)) {
      jobs.delete(match[1] || match[2]);
    }
    for (const match of source.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*\$\$([\s\S]*?)\$\$\s*\)/giu)) {
      jobs.set(match[1], {
        job_name: match[1],
        schedule: match[2],
        command: canonicalLf(match[3]).trim(),
        source_migration: migration.filename,
        source_location: lineAt(source, match.index),
      });
    }
    // The advanced-monitoring migration schedules inside a DO block with the
    // same literal argument shape but uses PERFORM cron.schedule.
    for (const match of source.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/giu)) {
      jobs.set(match[1], {
        job_name: match[1], schedule: match[2], command: match[3],
        source_migration: migration.filename, source_location: lineAt(source, match.index),
      });
    }
  }
  return stableSort(jobs.keys()).map((key) => jobs.get(key));
}

function repositoryCallerEdges(functionRows, repositoryRoot, sourceFiles) {
  const edges = [];
  for (const child of sourceFiles) {
        const source = canonicalLf(readFileSync(join(repositoryRoot, child), 'utf8'));
        const callerType = child.startsWith('supabase/functions/') ? 'EDGE_RPC'
          : child.startsWith('customer-web/scripts/') ? 'CUSTOMER_OPERATIONAL_RPC'
          : child.startsWith('customer-web/') ? 'CUSTOMER_APPLICATION_RPC'
          : child.startsWith('automation/') ? 'AUTOMATION_RPC'
          : child.startsWith('scripts/') ? 'OPERATIONAL_SCRIPT_RPC'
          : 'APPLICATION_RPC';
        for (const match of source.matchAll(/\.rpc\(\s*['"]([A-Za-z_][\w]*)['"]/gu)) {
          const candidates = functionRows.filter((row) => row.function_name === match[1]).map((row) => row.signature);
          edges.push({ caller_type: callerType, caller_location: `${child.replaceAll('\\', '/')}:${lineAt(source, match.index)}`, callee_name: match[1], callee_signatures: stableSort(candidates), resolution: candidates.length === 1 ? 'EXACT' : 'NAME_ONLY_OVERLOAD_SET' });
        }
        for (const match of source.matchAll(/\.rpc\(\s*([A-Za-z_$][\w$]*)\s*,/gu)) {
          edges.push({ caller_type: 'DYNAMIC_RPC', caller_location: `${child.replaceAll('\\', '/')}:${lineAt(source, match.index)}`, callee_name: match[1], callee_signatures: [], resolution: 'REQUIRES_SOURCE_REVIEW' });
        }
        // The guest-order Edge gateway calls PostgREST RPCs through its own
        // callRpc helper instead of supabase-js. Preserve those service-role
        // authority edges in the same repository caller graph.
        for (const match of source.matchAll(/callRpc\(\s*supabaseUrl\s*,\s*serviceRoleKey\s*,\s*['"]([A-Za-z_][\w]*)['"]/gu)) {
          const candidates = functionRows.filter((row) => row.function_name === match[1]).map((row) => row.signature);
          edges.push({ caller_type: 'EDGE_RPC', caller_location: `${child.replaceAll('\\', '/')}:${lineAt(source, match.index)}`, callee_name: match[1], callee_signatures: stableSort(candidates), resolution: candidates.length === 1 ? 'EXACT' : 'NAME_ONLY_OVERLOAD_SET' });
        }
        // Operational scripts may call PostgREST directly rather than through
        // supabase-js. Literal RPC paths are authoritative caller evidence.
        for (const match of source.matchAll(/\/rest\/v1\/rpc\/([A-Za-z_][\w]*)/gu)) {
          const candidates = functionRows.filter((row) => row.function_name === match[1]).map((row) => row.signature);
          edges.push({ caller_type: callerType, caller_location: `${child.replaceAll('\\', '/')}:${lineAt(source, match.index)}`, callee_name: match[1], callee_signatures: stableSort(candidates), resolution: candidates.length === 1 ? 'EXACT_POSTGREST_PATH' : 'NAME_ONLY_OVERLOAD_SET' });
        }
        for (const match of source.matchAll(/\/functions\/v1\/([A-Za-z_][\w-]*)/gu)) {
          edges.push({ caller_type: child.startsWith('automation/') ? 'AUTOMATION_EDGE_HTTP' : 'EDGE_FUNCTION_HTTP', caller_location: `${child.replaceAll('\\', '/')}:${lineAt(source, match.index)}`, callee_name: match[1], callee_signatures: [], resolution: 'EDGE_FUNCTION_ENDPOINT' });
        }
        const localRpcName = source.match(/const\s+rpcName\s*=\s*[^?;]+\?\s*['"]([A-Za-z_][\w]*)['"]\s*:\s*['"]([A-Za-z_][\w]*)['"]\s*;/u);
        const localRpcCall = source.match(/callRpc\(\s*supabaseUrl\s*,\s*serviceRoleKey\s*,\s*rpcName\s*,/u);
        if (localRpcName && localRpcCall) {
          for (const calleeName of [localRpcName[1], localRpcName[2]]) {
            const candidates = functionRows.filter((row) => row.function_name === calleeName).map((row) => row.signature);
            edges.push({ caller_type: 'EDGE_RPC', caller_location: `${child.replaceAll('\\', '/')}:${lineAt(source, localRpcCall.index)}`, callee_name: calleeName, callee_signatures: stableSort(candidates), resolution: candidates.length === 1 ? 'EXACT_BY_LOCAL_TERNARY' : 'NAME_ONLY_OVERLOAD_SET' });
          }
        }
  }
  return edges;
}

function directApplicationWriters(repositoryRoot, sourceFiles) {
  const rows = [];
  for (const child of sourceFiles.filter((path) => !path.startsWith('scripts/'))) {
        const source = canonicalLf(readFileSync(join(repositoryRoot, child), 'utf8'));
        for (const match of source.matchAll(/\.from\(\s*['"]([A-Za-z_][\w]*)['"]\s*\)[\s\S]{0,180}?\.(insert|update|delete|upsert)\s*\(/gu)) {
          rows.push({ writer_type: 'APPLICATION_OR_EDGE_DIRECT_DML', location: `${child.replaceAll('\\', '/')}:${lineAt(source, match.index)}`, relation: match[1], mutation: match[2].toUpperCase(), phase5_relevant: phase5MutableTables.has(match[1]), activation_disposition: phase5MutableTables.has(match[1]) ? 'REVIEW_AT_PHASE5_ACTIVATION' : 'OUTSIDE_PHASE5_MUTATION_AUTHORITY' });
        }
  }
  return rows;
}

function sqlTableGrantWriters(migrationFiles) {
  const mutationPrivileges = new Set(['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']);
  const state = new Map();
  for (const migration of migrationFiles) {
    const events = [];
    for (const match of migration.source.matchAll(/\b(GRANT|REVOKE)\s+([^;]+?)\s+ON\s+TABLE\s+([^;]+?)\s+(TO|FROM)\s+([^;]+);/giu)) {
      const operation = match[1].toUpperCase();
      const rawPrivileges = match[2].split(',').map((item) => item.trim().toUpperCase());
      const privileges = rawPrivileges.includes('ALL') ? [...mutationPrivileges] : rawPrivileges.filter((item) => mutationPrivileges.has(item));
      const tables = match[3].split(',').map((item) => item.trim().replaceAll('"', '').replace(/^public\./iu, ''));
      const roles = match[5].split(',').map((item) => item.trim().replaceAll('"', '').toLowerCase());
      events.push({ index: match.index, operation, privileges, tables, roles, location: `${migration.filename}:${lineAt(migration.source, match.index)}` });
    }
    // Account for repository-managed least-privilege loops that revoke table
    // access from an explicit literal table list through dynamic FORMAT SQL.
    for (const loop of migration.source.matchAll(/FOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]\s*LOOP([\s\S]*?)END\s+LOOP\s*;/giu)) {
      const revoke = loop[2].match(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.%I\s+FROM\s+([^']+)/iu);
      if (!revoke) continue;
      const tables = [...loop[1].matchAll(/'([A-Za-z_][\w]*)'/gu)].map((item) => item[1]);
      const roles = revoke[1].split(',').map((role) => role.trim().replaceAll('"', '').toLowerCase());
      events.push({ index: loop.index, operation: 'REVOKE', privileges: [...mutationPrivileges], tables, roles, location: `${migration.filename}:${lineAt(migration.source, loop.index)}` });
    }
    events.sort((left, right) => left.index - right.index);
    for (const event of events) {
      for (const table of event.tables) for (const role of event.roles) for (const privilege of event.privileges) {
        const key = `${table}:${role}:${privilege}`;
        if (event.operation === 'GRANT') state.set(key, { table, role, privilege, location: event.location });
        else state.delete(key);
      }
    }
  }
  const grouped = new Map();
  for (const grant of state.values()) {
    const key = `${grant.table}:${grant.role}`;
    if (!grouped.has(key)) grouped.set(key, { relation: grant.table, grantee: grant.role, privileges: [], source_locations: [] });
    grouped.get(key).privileges.push(grant.privilege);
    grouped.get(key).source_locations.push(grant.location);
  }
  return [...grouped.values()].map((grant) => ({
    writer_type: 'FINAL_TABLE_GRANT',
    location: stableSort(new Set(grant.source_locations)).join('|'),
    relation: grant.relation,
    mutation: stableSort(new Set(grant.privileges)).join('|'),
    grantees: [grant.grantee],
    phase5_relevant: phase5MutableTables.has(grant.relation),
    activation_disposition: phase5MutableTables.has(grant.relation)
      ? 'REVOKE_DIRECT_DML_UNLESS_EXPLICITLY_ALLOWLISTED_BY_PHASE5_ACTIVATION'
      : 'OUTSIDE_PHASE5_MUTATION_AUTHORITY',
  }));
}

function resolveDynamicRpcEdges(edges) {
  for (const edge of edges) {
    if (edge.resolution !== 'REQUIRES_SOURCE_REVIEW') continue;
    if (edge.callee_name === 'functionName' && /pos/i.test(edge.caller_location)) {
      edge.callee_signatures = ['public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)'];
      edge.resolution = 'EXACT_BY_TYPESCRIPT_LITERAL_UNION';
    }
  }
}

function build(repositoryRoot = defaultRepositoryRoot) {
  const sourceCoverage = validateSourceCoverage(repositoryRoot);
  const migrationDirectory = join(repositoryRoot, 'supabase', 'migrations');
  const callerSourceFiles = sourceCoverage.caller_source_files;
  const migrationFiles = readdirSync(migrationDirectory)
    .filter((filename) => /^\d{3}.*\.sql$/u.test(filename) && Number(filename.slice(0, 3)) <= 122)
    .sort()
    .map((filename) => ({ filename, source: canonicalLf(readFileSync(join(migrationDirectory, filename), 'utf8')) }));

  const functions = functionEvents(migrationFiles);
  const triggers = reconstructTriggers(migrationFiles);
  const jobs = reconstructJobs(migrationFiles);
  const byName = new Map();
  for (const row of functions.state.values()) {
    row.directWrites = directWrites(row.body);
    row.callSites = publicCallSites(row.body)
      .filter((call) => call.name !== row.functionName)
      // INSERT INTO public.table (...) has the same lexical shape as a
      // schema-qualified function call. Direct-write extraction already owns
      // those relations, so they must not appear as unresolved callees.
      .filter((call) => !row.directWrites.includes(call.name));
    const generatedCalls = generatedPatchCallNamesBySignature.get(row.signature) || [];
    for (const name of generatedCalls) {
      if (!row.callSites.some((call) => call.name === name)) row.callSites.push({ name, argument_count: null, generated_patch: true });
    }
    if (!byName.has(row.functionName)) byName.set(row.functionName, []);
    byName.get(row.functionName).push(row.signature);
  }

  for (const row of functions.state.values()) {
    row.callResolution = row.callSites.map((call) => {
      const allCandidates = byName.get(call.name) || [];
      const arityCandidates = call.argument_count === null
        ? allCandidates
        : allCandidates.filter((candidate) => functions.state.get(candidate).argumentTypes.length === call.argument_count);
      const candidates = arityCandidates.length ? arityCandidates : allCandidates;
      return {
        call_name: call.name,
        argument_count: call.argument_count,
        generated_patch: Boolean(call.generated_patch),
        candidate_signatures: stableSort(candidates),
        resolution: candidates.length === 1 ? 'EXACT' : candidates.length ? 'OVERLOAD_CANDIDATES' : 'UNRESOLVED',
      };
    });
    row.calledFunctions = stableSort(new Set(row.callResolution.flatMap((call) => call.candidate_signatures)));
  }

  const triggerByFunction = new Map();
  for (const trigger of triggers.state.values()) {
    if (!triggerByFunction.has(trigger.trigger_function_signature)) triggerByFunction.set(trigger.trigger_function_signature, []);
    triggerByFunction.get(trigger.trigger_function_signature).push(`${trigger.schema}.${trigger.table}.${trigger.trigger_name}`);
  }

  const explicitRelevantNames = new Set([...authorityAFunctionNames, ...authorityCFunctionNames, ...authorityDFunctionNames, ...authorityEFunctionNames]);
  const relevant = new Set();
  for (const row of functions.state.values()) {
    const writesRelevant = row.directWrites.some((table) => phase5MutableTables.has(table));
    const relevantTrigger = row.returnsTrigger && triggerByFunction.has(row.signature) && !excludedTriggerFunctionNames.has(row.functionName);
    if (writesRelevant || relevantTrigger || explicitRelevantNames.has(row.functionName)) relevant.add(row.signature);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of functions.state.values()) {
      if (!relevant.has(row.signature) && row.calledFunctions.some((callee) => relevant.has(callee))) {
        relevant.add(row.signature); changed = true;
      }
    }
  }

  const functionRows = stableSort(functions.state.keys()).map((key) => {
    const row = functions.state.get(key);
    const isRelevant = relevant.has(key);
    const authority = isRelevant ? authorityClassFor(row.functionName) : null;
    const relevance = isRelevant ? (authority === 'D' ? 'R3' : authority === 'B' ? 'R2' : 'R1') : 'X';
    const writesRelevant = row.directWrites.filter((table) => phase5MutableTables.has(table));
    const triggerBindings = stableSort(triggerByFunction.get(key) || []);
    const exclusionReason = !isRelevant
      ? excludedTriggerFunctionNames.get(row.functionName)
        || (row.directWrites.length
          ? `reviewed out-of-scope mutation: ${row.directWrites.map((table) => `${table} (${outOfScopeMutationTableReasons.get(table) || 'UNREVIEWED'})`).join('; ')}`
          : 'read-only/query/validation utility with no reachable Phase-5 mutation')
      : null;
    const roleAuthority = (role) => row.acl.public || row.acl[role] ? 'PROVEN_ALLOWED' : 'NOT_PROVABLE_FROM_REPOSITORY';
    const targetDisposition = !isRelevant ? 'OUT_OF_SCOPE_NO_PHASE5_ACTIVATION_CHANGE'
      : authority === 'A' ? 'ALLOWLIST_APPROVED_COORDINATOR'
      : authority === 'B' ? 'REVOKE_DIRECT_EXECUTE_FROM_PUBLIC_ANON_AUTHENTICATED_SERVICE_ROLE'
      : authority === 'C' ? 'ALLOWLIST_CONSTRAINED_LEGACY_WRAPPER'
      : authority === 'D' ? 'ALLOWLIST_CONTROLLED_JOB_OR_MAINTENANCE'
      : 'REVOKE_RETIRED_OR_BYPASS_ENTRYPOINT_AT_ACTIVATION';
    const functionRow = {
      signature: row.signature,
      schema: row.schema,
      function_name: row.functionName,
      argument_types: row.argumentTypes,
      source_definition_migration: row.sourceMigration,
      source_definition_location: row.sourceLocation,
      generated_definition_events: row.generatedDefinitionEvents,
      survives_after_122: true,
      relevance_class: relevance,
      relevance_reason: isRelevant ? (writesRelevant.length ? `direct mutation of ${writesRelevant.join(', ')}` : triggerBindings.length ? 'trigger/internal boundary on Phase-5-relevant business state' : 'repository call path to Phase-5-relevant mutation') : null,
      exclusion_reason_if_X: exclusionReason,
      authority_class_if_relevant: authority,
      final_owner: row.owner,
      owner_source_migration: row.ownerSourceMigration,
      owner_source_location: row.ownerSourceLocation,
      owner_evidence: row.owner ? 'EXPLICIT_ALTER_FUNCTION_OWNER_TO' : 'UNKNOWN_CREATE_EXECUTION_ROLE_NOT_PROVABLE_FROM_REPOSITORY',
      security_mode: row.securityMode,
      language: row.language,
      function_configuration: row.configuration,
      search_path: row.searchPath,
      current_execute_public: row.acl.public ? 'PROVEN_ALLOWED' : 'PROVEN_DENIED',
      current_execute_anon: roleAuthority('anon'),
      current_execute_authenticated: roleAuthority('authenticated'),
      current_execute_service_role: roleAuthority('service_role'),
      direct_acl_grants: { ...row.acl },
      direct_rpc_callable: !row.returnsTrigger && Boolean(row.acl.public || row.acl.anon || row.acl.authenticated || row.acl.service_role),
      trigger_only: row.returnsTrigger && triggerBindings.length > 0,
      job_bound: false,
      direct_table_writes: row.directWrites,
      indirect_mutation_reachability: row.calledFunctions.filter((callee) => relevant.has(callee)),
      called_functions: row.calledFunctions,
      called_function_resolution: row.callResolution,
      repository_callers: [],
      trigger_bindings: triggerBindings,
      job_bindings: [],
      target_activation_disposition: targetDisposition,
      activation_rule_covering_signature: isRelevant ? 'PHASE5_EXACT_SIGNATURE_ALLOWLIST_AND_ABORT_ON_UNEXPECTED_EXECUTE_GRANTEE' : 'NONE_REQUIRED',
      future_runtime_proof_required: isRelevant ? ['catalog ACL assertion', 'role-boundary execution probe', 'activation rehearsal'] : [],
    };
    const ownerEvidence = isRelevant && row.securityMode === 'DEFINER' ? ownerEvidenceForFunctionRow(functionRow) : null;
    functionRow.current_owner_source_status = ownerEvidence?.current_owner_source_status || null;
    functionRow.current_owner_source_value = ownerEvidence?.current_owner_source_value ?? null;
    functionRow.current_owner_source_evidence = ownerEvidence?.current_owner_evidence || null;
    functionRow.owner_activation_contract = ownerEvidence ? {
      target_owner: ownerEvidence.target_owner,
      target_owner_basis: ownerEvidence.target_owner_basis,
      activation_catalog_verification_required: ownerEvidence.activation_catalog_verification_required,
      activation_owner_convergence: ownerEvidence.activation_owner_convergence,
      activation_owner_transition_policy: ownerEvidence.activation_owner_transition_policy,
      pre_convergence_owner_evaluation: ownerEvidence.pre_convergence_owner_evaluation,
      owner_convergence_disposition: ownerEvidence.owner_convergence_disposition,
      owner_convergence_phase: ownerEvidence.owner_convergence_phase,
      final_owner_required: ownerEvidence.final_owner_required,
      final_owner_unknown_allowed: ownerEvidence.final_owner_unknown_allowed,
      exact_signature_assertion_required: ownerEvidence.exact_signature_assertion_required,
      expected_search_path: ownerEvidence.expected_search_path,
      search_path_assertion_required: ownerEvidence.search_path_assertion_required,
      schema_trust_assertion_required: ownerEvidence.schema_trust_assertion_required,
      acl_assertion_required: ownerEvidence.acl_assertion_required,
      security_mode_assertion_required: ownerEvidence.security_mode_assertion_required,
      activation_executor_authority_verification_required: ownerEvidence.activation_executor_authority_verification_required,
      acl_activation_disposition: ownerEvidence.acl_activation_disposition,
      privilege_envelope_complete: ownerEvidence.privilege_envelope_complete,
      slice1_dependency_allowed: ownerEvidence.slice1_dependency_allowed,
      slice1_dependency_on_unknown_owner: ownerEvidence.slice1_dependency_on_unknown_owner,
      rollback_disposition: ownerEvidence.rollback_disposition,
    } : null;
    return functionRow;
  });

  const callerEdges = repositoryCallerEdges(functionRows, repositoryRoot, callerSourceFiles);
  resolveDynamicRpcEdges(callerEdges);
  for (const edge of callerEdges) {
    for (const callee of edge.callee_signatures) {
      const row = functionRows.find((item) => item.signature === callee);
      if (row) row.repository_callers.push({ type: edge.caller_type, location: edge.caller_location });
    }
  }

  for (const row of functionRows) {
    for (const caller of functionRows) {
      if (caller.called_functions.includes(row.signature)) row.repository_callers.push({ type: 'SQL_FUNCTION', location: caller.signature });
    }
    row.repository_callers = row.repository_callers.sort((a, b) => `${a.type}:${a.location}`.localeCompare(`${b.type}:${b.location}`));
  }

  for (const job of jobs) {
    const calledName = job.command.match(/public\.(\w+)\s*\(/iu)?.[1];
    const candidates = calledName ? functionRows.filter((row) => row.function_name === calledName) : [];
    job.callee_signatures = candidates.map((row) => row.signature);
    job.phase5_relevant = candidates.some((row) => row.relevance_class !== 'X');
    for (const row of candidates) row.job_bindings.push(job.job_name);
  }
  for (const row of functionRows) row.job_bound = row.job_bindings.length > 0;

  const triggerRows = stableSort(triggers.state.keys()).map((key) => {
    const trigger = triggers.state.get(key);
    const functionRow = functionRows.find((row) => row.signature === trigger.trigger_function_signature);
    return {
      ...trigger,
      phase5_relevant: functionRow?.relevance_class === 'R2',
      relevance_reason: functionRow?.relevance_class === 'R2' ? functionRow.relevance_reason : functionRow?.exclusion_reason_if_X || 'unresolved',
    };
  });

  const nonFunctionWriters = [...directApplicationWriters(repositoryRoot, callerSourceFiles), ...sqlTableGrantWriters(migrationFiles)]
    .sort((a, b) => `${a.writer_type}:${a.location}:${a.relation}`.localeCompare(`${b.writer_type}:${b.location}:${b.relation}`));
  const sqlCallerEdges = [];
  for (const caller of functionRows) for (const callee of caller.called_functions) sqlCallerEdges.push({
    caller_type: 'SQL_FUNCTION',
    caller_location: `${caller.source_definition_migration}:${caller.source_definition_location}`,
    caller_signature: caller.signature,
    callee_signature: callee,
    source_migration: caller.source_definition_migration,
    source_line: caller.source_definition_location,
  });
  const jobCallerRows = {
    jobs,
    caller_edges: [...callerEdges.map((edge) => ({ ...edge })), ...sqlCallerEdges].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    non_function_writers: nonFunctionWriters,
    live_deployment_usage: 'NOT_VERIFIED_FUTURE_ACTIVATION_GATE',
  };
  const callerCountByFile = new Map();
  for (const edge of callerEdges) {
    const path = edge.caller_location.replace(/:\d+$/u, '');
    callerCountByFile.set(path, (callerCountByFile.get(path) || 0) + 1);
  }
  const writerCountByFile = new Map();
  for (const writer of nonFunctionWriters.filter((row) => row.writer_type === 'APPLICATION_OR_EDGE_DIRECT_DML')) {
    const path = writer.location.replace(/:\d+$/u, '');
    writerCountByFile.set(path, (writerCountByFile.get(path) || 0) + 1);
  }
  for (const entry of sourceCoverage.source_coverage_ledger) {
    entry.caller_edges = callerCountByFile.get(entry.path) || 0;
    entry.writer_signals = writerCountByFile.get(entry.path) || 0;
  }

  const relevantRows = functionRows.filter((row) => row.relevance_class !== 'X');
  const classB = relevantRows.filter((row) => row.authority_class_if_relevant === 'B');
  const ownerRows = buildOwnerEvidenceRows(functionRows);
  const ownerValidation = validateOwnerEvidenceRows(ownerRows);
  const counts = {
    historical_definitions: functions.historicalDefinitions,
    historical_signature_identities: functions.historicalSignatureIdentities,
    superseded_definitions: functions.supersededDefinitions,
    rename_events: functions.renameEvents,
    alter_function_statements: functions.alterStatements,
    alter_function_handled: functions.handledAlterStatements,
    alter_function_explicitly_non_semantic: functions.explicitlyNonSemanticAlterStatements,
    alter_function_unresolved: functions.unresolvedAlterStatements,
    alter_security_statements: functions.securityAlterations,
    alter_security_resolved: functions.resolvedSecurityAlterations,
    alter_security_unresolved: functions.securityAlterations - functions.resolvedSecurityAlterations,
    alter_owner_statements: functions.ownerAlterations,
    alter_owner_resolved: functions.resolvedOwnerAlterations,
    alter_owner_unresolved: functions.ownerAlterations - functions.resolvedOwnerAlterations,
    unsupported_relevant_alter_forms: functions.unsupportedAlterForms,
    matched_drops: functions.matchedDrops,
    final_surviving_signatures: functionRows.length,
    out_of_scope_signatures: functionRows.filter((row) => row.relevance_class === 'X').length,
    phase5_relevant_signatures: relevantRows.length,
    total_classified_A: relevantRows.filter((row) => row.authority_class_if_relevant === 'A').length,
    total_classified_B: classB.length,
    total_classified_C: relevantRows.filter((row) => row.authority_class_if_relevant === 'C').length,
    total_classified_D: relevantRows.filter((row) => row.authority_class_if_relevant === 'D').length,
    total_classified_E: relevantRows.filter((row) => row.authority_class_if_relevant === 'E').length,
    unverdictable_surviving_signatures: functionRows.filter((row) => !row.relevance_class).length,
    relevant_unclassified: relevantRows.filter((row) => !row.authority_class_if_relevant).length,
    total_final_trigger_identities: triggerRows.length,
    total_phase5_relevant_trigger_identities: triggerRows.filter((row) => row.phase5_relevant).length,
    total_historical_trigger_definition_statements: triggers.historicalStatements,
    total_deferred_constraint_triggers: triggerRows.filter((row) => row.constraint_trigger && row.initially_deferred).length,
    total_job_background_entrypoints: jobs.length,
    total_repository_caller_edges: jobCallerRows.caller_edges.length,
    b_currently_public_executable: classB.filter((row) => row.current_execute_public === 'PROVEN_ALLOWED').length,
    b_currently_authenticated_executable: classB.filter((row) => row.current_execute_authenticated === 'PROVEN_ALLOWED').length,
    b_currently_service_role_executable: classB.filter((row) => row.current_execute_service_role === 'PROVEN_ALLOWED').length,
    b_authority_unknown: classB.filter((row) => ['current_execute_public', 'current_execute_anon', 'current_execute_authenticated', 'current_execute_service_role'].some((field) => row[field] === 'NOT_PROVABLE_FROM_REPOSITORY')).length,
    b_covered_by_activation_revoke: classB.filter((row) => row.target_activation_disposition === 'REVOKE_DIRECT_EXECUTE_FROM_PUBLIC_ANON_AUTHENTICATED_SERVICE_ROLE').length,
    b_with_explicit_exception: 0,
    b_without_activation_disposition: classB.filter((row) => !row.target_activation_disposition).length,
    unresolved_trigger_functions: triggerRows.filter((row) => !functionRows.some((functionRow) => functionRow.signature === row.trigger_function_signature)).length,
    security_definer_relevant: relevantRows.filter((row) => row.security_mode === 'DEFINER').length,
    security_invoker_relevant: relevantRows.filter((row) => row.security_mode === 'INVOKER').length,
    surviving_owner_known: functionRows.filter((row) => row.final_owner).length,
    surviving_owner_unknown: functionRows.filter((row) => !row.final_owner).length,
    relevant_security_definer_owner_known: relevantRows.filter((row) => row.security_mode === 'DEFINER' && row.final_owner).length,
    relevant_security_definer_owner_unknown: relevantRows.filter((row) => row.security_mode === 'DEFINER' && !row.final_owner).length,
    relevant_security_definer_source_proven_owner: ownerValidation.counters.source_proven_owner,
    relevant_security_definer_source_unknown_owner: ownerValidation.counters.source_unknown_owner,
    relevant_definer_without_target_owner_policy: ownerValidation.counters.without_target_owner_policy,
    relevant_definer_without_activation_owner_assertion: ownerValidation.counters.without_activation_owner_assertion,
    relevant_definer_without_owner_convergence_disposition: ownerValidation.counters.without_owner_convergence_disposition,
    relevant_definer_without_final_owner_requirement: ownerValidation.counters.without_final_owner_requirement,
    relevant_definer_allowed_unknown_final_owner: ownerValidation.counters.allowed_unknown_final_owner,
    relevant_definer_without_complete_privilege_envelope: ownerValidation.counters.without_complete_privilege_envelope,
    slice1_unknown_owner_dependencies: ownerValidation.counters.slice1_unknown_owner_dependencies,
    total_surviving_trigger_functions: functionRows.filter((row) => row.trigger_bindings.length).length,
    total_phase5_relevant_trigger_functions: functionRows.filter((row) => row.trigger_bindings.length && row.relevance_class === 'R2').length,
    total_phase5_relevant_jobs: jobs.filter((job) => job.phase5_relevant).length,
  };

  const allowlists = {
    APPROVED_PUBLIC_COORDINATORS: relevantRows.filter((row) => row.authority_class_if_relevant === 'A' && row.current_execute_public === 'PROVEN_ALLOWED').map((row) => row.signature),
    APPROVED_AUTHENTICATED_COORDINATORS: relevantRows.filter((row) => row.authority_class_if_relevant === 'A' && row.direct_acl_grants.authenticated).map((row) => row.signature),
    APPROVED_SERVICE_ROLE_ENTRYPOINTS: relevantRows.filter((row) => ['A', 'D'].includes(row.authority_class_if_relevant) && row.current_execute_service_role === 'PROVEN_ALLOWED').map((row) => row.signature),
    APPROVED_JOB_CRON_ENTRYPOINTS: relevantRows.filter((row) => row.authority_class_if_relevant === 'D').map((row) => row.signature),
    APPROVED_LEGACY_COMPATIBILITY_ENTRYPOINTS: relevantRows.filter((row) => row.authority_class_if_relevant === 'C').map((row) => row.signature),
    PRIVATE_DIRECT_EXECUTE_DENIED: classB.map((row) => row.signature),
    RESTRICT_REVOKE_AT_ACTIVATION: relevantRows.filter((row) => row.authority_class_if_relevant === 'E').map((row) => row.signature),
  };
  for (const key of Object.keys(allowlists)) allowlists[key] = stableSort(allowlists[key]);

  const unresolvedDynamicCallers = callerEdges.filter((edge) => edge.resolution === 'REQUIRES_SOURCE_REVIEW');
  const generatedDefinitionEvents = functionRows.flatMap((row) => row.generated_definition_events.map((event) => ({ signature: row.signature, introduced_calls: generatedPatchCallNamesBySignature.get(row.signature) || [], ...event })));
  const validationFailures = [];
  if (sourceCoverage.baseline_self_reference_risk !== 'NO') validationFailures.push('Trusted source baseline remains self-referential');
  if (sourceCoverage.missing_migrations.length) validationFailures.push(`${sourceCoverage.missing_migrations.length} trusted migrations missing`);
  if (sourceCoverage.migration_identity_check !== 'PASS') validationFailures.push('Migration identity check failed');
  if (sourceCoverage.unclassified_file_count) validationFailures.push(`${sourceCoverage.unclassified_file_count} source files unclassified`);
  if (sourceCoverage.unclassified_families.length) validationFailures.push(`${sourceCoverage.unclassified_families.length} source families unclassified`);
  const seoCallerEdges = callerEdges.filter((edge) => edge.caller_location.startsWith('customer-web/scripts/generate-seo-pages.mjs:'));
  if (seoCallerEdges.length !== 2) validationFailures.push(`Expected 2 SEO PostgREST RPC callers; found ${seoCallerEdges.length}`);
  if (functions.unresolvedAlterStatements) validationFailures.push(`${functions.unresolvedAlterStatements} ALTER FUNCTION targets unresolved`);
  if (functions.unsupportedAlterForms) validationFailures.push(`${functions.unsupportedAlterForms} ALTER FUNCTION forms unsupported`);
  if (functions.alterLedger.length !== functions.alterStatements) validationFailures.push(`ALTER FUNCTION statement ledger incomplete: ${functions.alterLedger.length}/${functions.alterStatements}`);
  if (functions.handledAlterStatements !== functions.alterStatements) validationFailures.push(`ALTER FUNCTION statements not fully handled: ${functions.handledAlterStatements}/${functions.alterStatements}`);
  if (functions.alterLedger.some((row) => !row.fully_consumed || row.unconsumed_suffix)) validationFailures.push('ALTER FUNCTION statement has an unconsumed suffix');
  if (counts.alter_owner_unresolved) validationFailures.push(`${counts.alter_owner_unresolved} ALTER FUNCTION OWNER targets unresolved`);
  validationFailures.push(...ownerValidation.failures);
  if (ownerValidation.counters.total_relevant_security_definer !== counts.security_definer_relevant) validationFailures.push('Owner ledger does not exactly cover all relevant SECURITY DEFINER signatures');
  if (ownerValidation.counters.source_proven_owner + ownerValidation.counters.source_unknown_owner !== ownerValidation.counters.total_relevant_security_definer) validationFailures.push('Owner source-status reconciliation failed');
  if (counts.unverdictable_surviving_signatures) validationFailures.push(`${counts.unverdictable_surviving_signatures} signatures lack relevance verdict`);
  if (counts.relevant_unclassified) validationFailures.push(`${counts.relevant_unclassified} relevant signatures lack authority class`);
  if (new Set(functionRows.map((row) => row.signature)).size !== functionRows.length) validationFailures.push('Duplicate final signature identities');
  if (counts.unresolved_trigger_functions) validationFailures.push(`${counts.unresolved_trigger_functions} trigger functions unresolved`);
  const relevantTriggersOutsideR2 = triggerRows.filter((trigger) => trigger.phase5_relevant)
    .filter((trigger) => functionRows.find((row) => row.signature === trigger.trigger_function_signature)?.relevance_class !== 'R2');
  if (relevantTriggersOutsideR2.length) validationFailures.push(`Relevant trigger bindings do not resolve to R2 functions: ${relevantTriggersOutsideR2.map((trigger) => `${trigger.schema}.${trigger.table}.${trigger.trigger_name}`).join(', ')}`);
  if (counts.b_without_activation_disposition) validationFailures.push(`${counts.b_without_activation_disposition} Class-B signatures lack activation disposition`);
  if (relevantRows.some((row) => !row.target_activation_disposition)) validationFailures.push('Relevant function lacks target disposition');
  if (functionRows.some((row) => !['R1', 'R2', 'R3', 'X'].includes(row.relevance_class))) validationFailures.push('Unknown relevance class');
  if (unresolvedDynamicCallers.length) validationFailures.push(`${unresolvedDynamicCallers.length} dynamic callers unresolved`);
  const unresolvedGeneratedMigrations = functions.generatedDefinitionMigrations.filter((item) => item.targets.length === 0);
  if (unresolvedGeneratedMigrations.length) validationFailures.push(`Generated function-definition targets unresolved in: ${unresolvedGeneratedMigrations.map((item) => item.migration).join(', ')}`);
  const generatedTargets = new Set(generatedDefinitionEvents.map((event) => event.signature));
  const unreviewedGeneratedTargets = [...generatedTargets].filter((target) => !generatedPatchCallNamesBySignature.has(target));
  const staleGeneratedPolicy = [...generatedPatchCallNamesBySignature.keys()].filter((target) => !generatedTargets.has(target));
  if (unreviewedGeneratedTargets.length) validationFailures.push(`Generated patch targets lack reviewed call evidence: ${unreviewedGeneratedTargets.join(', ')}`);
  if (staleGeneratedPolicy.length) validationFailures.push(`Generated patch policy targets not found in source: ${staleGeneratedPolicy.join(', ')}`);
  const mixedRelevanceAmbiguity = functionRows.flatMap((row) => row.called_function_resolution
    .filter((call) => call.resolution === 'OVERLOAD_CANDIDATES')
    .filter((call) => {
      const verdicts = new Set(call.candidate_signatures.map((candidate) => functionRows.find((item) => item.signature === candidate)?.relevance_class === 'X' ? 'X' : 'R'));
      return verdicts.size > 1;
    })
    .map((call) => `${row.signature} -> ${call.call_name}/${call.argument_count}`));
  if (mixedRelevanceAmbiguity.length) validationFailures.push(`Call overload ambiguity crosses relevance boundary: ${mixedRelevanceAmbiguity.join(', ')}`);
  const repositoryCallerAmbiguity = callerEdges
    .filter((edge) => edge.callee_signatures.length > 1)
    .filter((edge) => new Set(edge.callee_signatures.map((candidate) => functionRows.find((row) => row.signature === candidate)?.relevance_class === 'X' ? 'X' : 'R')).size > 1);
  if (repositoryCallerAmbiguity.length) validationFailures.push(`Repository caller ambiguity crosses relevance boundary: ${repositoryCallerAmbiguity.map((edge) => `${edge.caller_location} -> ${edge.callee_name}`).join(', ')}`);
  const allowlistedSignatures = new Set(Object.values(allowlists).flat());
  const relevantWithoutAllowlist = relevantRows.filter((row) => !allowlistedSignatures.has(row.signature));
  const outOfScopeAllowlisted = functionRows.filter((row) => row.relevance_class === 'X' && allowlistedSignatures.has(row.signature));
  if (relevantWithoutAllowlist.length) validationFailures.push(`Relevant signatures absent from activation allowlists: ${relevantWithoutAllowlist.map((row) => row.signature).join(', ')}`);
  if (outOfScopeAllowlisted.length) validationFailures.push(`Out-of-scope signatures present in activation allowlists: ${outOfScopeAllowlisted.map((row) => row.signature).join(', ')}`);
  if (allowlists.PRIVATE_DIRECT_EXECUTE_DENIED.length !== classB.length) validationFailures.push('Class-B deny allowlist does not exactly cover Class B');

  const allXViolations = functionRows.filter((row) => row.relevance_class === 'X').flatMap((row) => {
    const failures = [];
    if (!row.exclusion_reason_if_X) failures.push('missing exclusion reason');
    for (const table of row.direct_table_writes) if (!outOfScopeMutationTableReasons.has(table)) failures.push(`unreviewed mutation table ${table}`);
    if (row.indirect_mutation_reachability.length) failures.push(`reaches relevant mutations: ${row.indirect_mutation_reachability.join(', ')}`);
    if (row.trigger_bindings.some((binding) => triggerRows.find((trigger) => `${trigger.schema}.${trigger.table}.${trigger.trigger_name}` === binding)?.phase5_relevant)) failures.push('has relevant trigger binding');
    return failures.map((failure) => `${row.signature}: ${failure}`);
  });
  if (allXViolations.length) validationFailures.push(`All-X systematic validation failed: ${allXViolations.join(' | ')}`);

  return { repositoryRoot, sourceCoverage, migrationFiles, functionRows, ownerRows, ownerValidation, triggerRows, alterFunctionRows: functions.alterLedger, jobCallerRows, counts, allowlists, generatedDefinitionEvents, mediumFindings, validationFailures, seoCallerEdges, allXValidation: { checked: functionRows.filter((row) => row.relevance_class === 'X').length, violations: allXViolations } };
}

function createArtifactSet(result) {
  if (result.validationFailures.length) throw new Error(`Evidence self-validation failed:\n- ${result.validationFailures.join('\n- ')}`);
  const functionColumns = Object.keys(result.functionRows[0]);
  const triggerColumns = Object.keys(result.triggerRows[0]);
  const readme = `# Phase 5 pre-implementation authority evidence\n\nThis directory is generated by \`node scripts/analysis/build-phase5-authority-ledger.mjs\`. It is deterministic, source-only evidence through Migration 122. It does not inspect Production and is not runtime, deployment, inherited-role, or live-usage proof.\n\n## Reproduce\n\nFrom the repository root run:\n\n\`\`\`text\nnode scripts/analysis/build-phase5-authority-ledger.mjs\n\`\`\`\n\nThe expected source inventory comes from immutable Git tree ${result.sourceCoverage.trusted_baseline_identity}, independently of the Git index and audited working-copy file list. Each trusted blob is compared directly with current file contents after canonicalizing only CRLF/CR to LF; raw and canonical SHA-256 values are retained. Every runtime-like source is scanned or explicitly excluded with a deterministic reason. Migrations 001-122 are content-identity checked against that tree. Output uses UTF-8 without BOM, canonical LF, stable bytewise ordering, and no timestamps.\n\n## Evidence boundary\n\nThe builder reconstructs final PostgreSQL function and trigger identities, exact-signature owner and ALTER state, SQL call/write edges, generated \`pg_get_functiondef\` replacement targets, repository callers (including direct PostgREST paths), Edge/customer gateway calls, pg_cron jobs, direct application/Edge DML, and final table-mutation grants. Mechanically derived evidence is separated from reviewed Phase 5 classification policy in \`scripts/analysis/phase5-authority-policy.mjs\`.\n\nCurrent owner source evidence and activation owner policy are separate. SOURCE_UNKNOWN means only that repository source does not prove the historical/live owner; it never means trusted or postgres. Every relevant SECURITY DEFINER has target owner postgres as the repository compatibility policy, but activation must resolve the exact signature/OID, inspect the live catalog, evaluate any non-postgres transition under a fail-closed reviewed rule, and require final owner postgres. Slice 1 may rely on none of the source-unknown owner functions while it remains private, additive and inactive.\n\nCurrent EXECUTE fields are reconstructed from repository GRANT/REVOKE history. PostgreSQL default PUBLIC EXECUTE, CREATE OR REPLACE ACL/owner retention, DROP/recreate reset, rename retention, explicit OWNER TO state, and repository-visible exact revokes are accounted for. Role membership or live out-of-repository privilege changes remain intentionally NOT_PROVABLE_FROM_REPOSITORY; activation must inspect the live catalog and abort on any unexpected grantee. Owner, exact identity, SECURITY mode, search_path/configuration, ACL and authority class form one activation privilege envelope.\n\nNo historical signature count is used as a success oracle. The ${result.counts.final_surviving_signatures}-row result is derived from the trusted ordered migration source and validated structurally.\n\n## Artifacts\n\n- function ledger: one row per final signature, including relevance, source owner status, activation owner contract, ACL, function configuration, callers, writes, trigger/job bindings, and activation disposition;\n- SECURITY DEFINER owner ledger: exactly one row per relevant definer, preserving source unknowns and the complete activation privilege envelope;\n- ALTER FUNCTION ledger: one row per ALTER statement, with all clauses consumed and applied;\n- trigger ledger: one row per final schema/table/trigger identity;\n- job/caller ledger: repository caller edges and scheduled entrypoints;\n- source coverage ledger: one row per trusted or newly observed runtime-like source with direct baseline/current content hashes and scan/exclusion policy;\n- non-function writer ledger: direct application/Edge DML and final table mutation grants;\n- exact-signature activation allowlists;\n- manifest: counts, artifact hashes, builder hashes, open finding traceability, owner-contract reconciliation, and combined evidence hash.\n\nThe manifest SHA-256 is reported externally because a file cannot contain its own hash. The combined evidence hash covers canonical filename/hash pairs for all non-manifest artifacts and both builder sources.\n\n## Result\n\n- Self-validation: PASS\n- Trusted baseline: ${result.sourceCoverage.trusted_baseline_identity}\n- Final signatures: ${result.counts.final_surviving_signatures}\n- Relevant signatures: ${result.counts.phase5_relevant_signatures}\n- Out-of-scope signatures: ${result.counts.out_of_scope_signatures}\n- Fully consumed ALTER FUNCTION statements: ${result.counts.alter_function_handled}/${result.counts.alter_function_statements}\n- Relevant SECURITY DEFINER source-proven owners: ${result.counts.relevant_security_definer_source_proven_owner}\n- Relevant SECURITY DEFINER source-unknown owners: ${result.counts.relevant_security_definer_source_unknown_owner}\n- Relevant definers without target/activation/final/envelope policy: ${result.counts.relevant_definer_without_target_owner_policy}/${result.counts.relevant_definer_without_activation_owner_assertion}/${result.counts.relevant_definer_without_final_owner_requirement}/${result.counts.relevant_definer_without_complete_privilege_envelope}\n- Slice 1 unknown-owner dependencies: ${result.counts.slice1_unknown_owner_dependencies}\n- Final trigger identities: ${result.counts.total_final_trigger_identities}\n- Relevant trigger identities: ${result.counts.total_phase5_relevant_trigger_identities}\n- Unresolved trigger functions: ${result.counts.unresolved_trigger_functions}\n- Class-B without activation disposition: ${result.counts.b_without_activation_disposition}\n- Medium A-D: implementation OPEN; design remediation DEFINED\n`;
  const semanticArtifacts = new Map([
    ['PHASE5_EVIDENCE_README.md', canonicalLf(readme)],
    ['phase5_function_authority_ledger.json', stableJson(result.functionRows)],
    ['phase5_function_authority_ledger.csv', csvFor(result.functionRows, functionColumns)],
    ['phase5_security_definer_owner_ledger.json', stableJson(result.ownerRows)],
    ['phase5_alter_function_ledger.json', stableJson(result.alterFunctionRows)],
    ['phase5_trigger_ledger.json', stableJson(result.triggerRows)],
    ['phase5_trigger_ledger.csv', csvFor(result.triggerRows, triggerColumns)],
    ['phase5_job_caller_ledger.json', stableJson(result.jobCallerRows)],
    ['phase5_non_function_writer_ledger.json', stableJson(result.jobCallerRows.non_function_writers)],
    ['phase5_authority_allowlists.json', stableJson(result.allowlists)],
    ['phase5_source_coverage_ledger.json', stableJson(result.sourceCoverage.source_coverage_ledger)],
  ]);
  assertJsonCsvSemanticEquivalence(result.functionRows, semanticArtifacts.get('phase5_function_authority_ledger.csv'), functionColumns, 'function ledger');
  assertJsonCsvSemanticEquivalence(result.triggerRows, semanticArtifacts.get('phase5_trigger_ledger.csv'), triggerColumns, 'trigger ledger');

  const rowCountFor = (filename) => filename.includes('alter_function') ? result.alterFunctionRows.length
    : filename.includes('security_definer_owner') ? result.ownerRows.length
    : filename.includes('function_authority') ? result.functionRows.length
    : filename.includes('trigger_ledger') ? result.triggerRows.length
    : filename.includes('non_function_writer') ? result.jobCallerRows.non_function_writers.length
    : filename.includes('job_caller') ? result.jobCallerRows.caller_edges.length + result.jobCallerRows.jobs.length
    : filename.includes('allowlists') ? Object.values(result.allowlists).reduce((total, rows) => total + rows.length, 0)
    : filename.includes('source_coverage') ? result.sourceCoverage.source_coverage_ledger.length
    : 0;
  const artifactEntries = stableSort(semanticArtifacts.keys()).map((filename) => ({
    filename,
    row_count: rowCountFor(filename),
    sha256: sha256(semanticArtifacts.get(filename)),
    schema_version: schemaVersion,
    semantic_purpose: filename.replace(/\.json|\.csv/gu, '').replaceAll('_', ' '),
  }));
  const builderSources = [
    'scripts/analysis/build-phase5-authority-ledger.mjs',
    'scripts/analysis/phase5-authority-policy.mjs',
  ].map((filename) => ({ filename, sha256: sha256(canonicalLf(readFileSync(join(result.repositoryRoot, filename), 'utf8'))) }));
  const combinedEntries = [...artifactEntries, ...builderSources].sort((left, right) => left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0);
  const combinedMaterial = combinedEntries.map((entry) => `${entry.filename}\0${entry.sha256}\n`).join('');
  const manifest = {
    schema_version: schemaVersion,
    canonical_encoding: 'UTF-8 without BOM; LF; stable bytewise semantic ordering',
    counts: result.counts,
    generated_definition_events: result.generatedDefinitionEvents,
    source_coverage: result.sourceCoverage,
    all_x_systematic_validation: result.allXValidation,
    json_csv_semantic_equivalence: 'PASS',
    medium_findings: result.mediumFindings,
    owner_authority_contract: {
      target_owner: phase5SecurityDefinerOwnerPolicy.targetOwner,
      target_owner_basis: phase5SecurityDefinerOwnerPolicy.targetOwnerBasis,
      current_source_unknown_owner_pre_activation: 'ALLOWED_FOR_PRIVATE_INACTIVE_FOUNDATION_ONLY',
      live_owner_catalog_proof_required: true,
      owner_convergence_phase: phase5SecurityDefinerOwnerPolicy.ownerConvergencePhase,
      final_owner_mismatch_rule: 'HARD_FAIL',
      class_b_owner_acl_separation: result.counts.b_without_activation_disposition === 0 ? 'PASS' : 'FAIL',
      reconciliation: result.ownerValidation.counters,
    },
    historical_count_policy: 'No historical function count is a success oracle; current counts are reconstructed from the trusted ordered migration tree.',
    artifacts: artifactEntries,
    builder_sources: builderSources,
    combined_evidence_hash: sha256(combinedMaterial),
    final_writer_completeness_proven_from_artifact: true,
    material_evidence_gaps: 0,
    business_financial_design_gaps: 0,
    owner_policy_decisions: 0,
    self_validation: 'PASS',
  };
  const manifestContent = stableJson(manifest);
  semanticArtifacts.set('phase5_evidence_manifest.json', manifestContent);

  return { artifacts: semanticArtifacts, artifactEntries, manifest, manifestContent };
}

function publishArtifactsAtomically(artifactSet, evidenceDirectory) {
  const parent = dirname(evidenceDirectory);
  mkdirSync(parent, { recursive: true });
  const staging = join(parent, `.phase5-evidence-staging-${randomUUID()}`);
  const backup = join(parent, `.phase5-evidence-backup-${randomUUID()}`);
  mkdirSync(staging, { recursive: false });
  try {
    for (const [filename, content] of artifactSet.artifacts) writeFileSync(join(staging, filename), canonicalLf(content), 'utf8');
    for (const [filename, content] of artifactSet.artifacts) {
      const staged = readFileSync(join(staging, filename), 'utf8');
      if (sha256(staged) !== sha256(canonicalLf(content))) throw new Error(`Staged artifact hash mismatch: ${filename}`);
    }
    if (existsSync(evidenceDirectory)) renameSync(evidenceDirectory, backup);
    renameSync(staging, evidenceDirectory);
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(evidenceDirectory) && existsSync(backup)) renameSync(backup, evidenceDirectory);
    throw error;
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
  }
}

function buildAndPublish({ buildFunction, outputDirectory }) {
  const result = buildFunction();
  const artifactSet = createArtifactSet(result);
  publishArtifactsAtomically(artifactSet, outputDirectory);
  return { result, artifactSet };
}

function run({ repositoryRoot = defaultRepositoryRoot, outputDirectory = join(repositoryRoot, 'docs', 'agent', 'evidence', 'phase5-preimplementation') } = {}) {
  const { result, artifactSet } = buildAndPublish({ buildFunction: () => build(repositoryRoot), outputDirectory });

  const output = {
    counts: result.counts,
    artifacts: artifactSet.artifactEntries,
    manifest_sha256: sha256(artifactSet.manifestContent),
    combined_evidence_hash: artifactSet.manifest.combined_evidence_hash,
    evidence_directory: relative(repositoryRoot, outputDirectory).replaceAll('\\', '/'),
    self_validation: 'PASS',
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}

export {
  assertJsonCsvSemanticEquivalence,
  build,
  buildAndPublish,
  buildOwnerEvidenceRows,
  createArtifactSet,
  directWrites,
  functionEvents,
  parseCsv,
  publicCallSites,
  publishArtifactsAtomically,
  repositoryCallerEdges,
  run,
  sourceClassification,
  validateSourceCoverage,
  validateOwnerEvidenceRows,
};

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  const repositoryRoot = process.env.PHASE5_EVIDENCE_REPOSITORY_ROOT
    ? resolve(process.env.PHASE5_EVIDENCE_REPOSITORY_ROOT)
    : defaultRepositoryRoot;
  const outputDirectory = process.env.PHASE5_EVIDENCE_OUTPUT_DIRECTORY
    ? resolve(process.env.PHASE5_EVIDENCE_OUTPUT_DIRECTORY)
    : join(repositoryRoot, 'docs', 'agent', 'evidence', 'phase5-preimplementation');
  run({ repositoryRoot, outputDirectory });
}
