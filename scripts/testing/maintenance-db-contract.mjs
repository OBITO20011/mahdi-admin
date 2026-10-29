import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

export const GRANDFATHERED_MIGRATION_CEILING = 138; // Fixed history, NEVER advance to exempt new migrations.
export const canonicalLf = text => text.replaceAll('\r\n', '\n');
// Definition-only transport normalization. Historical090's removal of LF+the
// street condition from087 can leave CR+CRLF on Windows. Keep migration byte
// fingerprints on canonicalLf unchanged;preserve bare CR and every SQL token.
export const canonicalDefinitionLf = text => text.replace(/\r+\n/gu,'\n');
export const sha256 = text => createHash('sha256').update(text).digest('hex');
export async function migrationManifest(root) {
  const directory = path.join(root, 'supabase/migrations');
  const names = (await readdir(directory)).filter(name => /^\d+_.+\.sql$/u.test(name)).sort();
  return Promise.all(names.map(async name => ({name, sha256: sha256(canonicalLf(await readFile(path.join(directory, name), 'utf8')))})));
}
export const manifestDigest = manifest => sha256(JSON.stringify(manifest));

// Preserve quoted text/identifiers and line positions; discard nested SQL comments.
export function withoutSqlComments(sql) {
  let out = '', quote = null, depth = 0;
  for (let n = 0; n < sql.length; n++) {
    const c = sql[n], next = sql[n + 1];
    if (depth) {
      if (c === '/' && next === '*') { depth++; out += '  '; n++; }
      else if (c === '*' && next === '/') { depth--; out += '  '; n++; }
      else out += c === '\n' ? '\n' : ' ';
    } else if (quote) {
      out += c;
      if (c === '\\' && quote === "'" && next) { out += next; n++; }
      else if (c === quote) { if (next === quote) { out += next; n++; } else quote = null; }
    } else if (c === "'" || c === '"') { quote = c; out += c; }
    else if (c === '/' && next === '*') { depth = 1; out += '  '; n++; }
    else if (c === '-' && next === '-') {
      while (n < sql.length && sql[n] !== '\n') { out += ' '; n++; }
      if (n < sql.length) out += '\n';
    } else out += c;
  }
  return out;
}

export function futureMigrationViolations(sql) {
  const code = withoutSqlComments(sql), errors = [];
  const identifier = '(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)';
  const declaration = new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:function|procedure)\\s+((?:${identifier}\\s*\\.\\s*)?${identifier})`, 'giu');
  //214 literally replaces one ALREADY EXISTING132 Return leaf. Permit only
  //the reviewed whole migration bytes and that exact CREATE OR REPLACE name;
  //new layers, overloads, renamed helpers and every other mutation still fail.
  const existing214ReturnLeaf = sha256(canonicalLf(sql)) === '4d00ea65cb3f1c916bf75f542748a37d56d8b87a3e96f67679fd69309bddc6b6';
  // Owner-approved215 retains three exact old leaves behind private wrappers
  // and replaces the existing closing reader. Only these whole reviewed bytes
  // may use those names; an extra comment, overload or helper still fails.
  const reviewed215 = sha256(canonicalLf(sql)) === '2d20594d6112c206a23130c43ce555ecc5357921cc9e4058019d0446223a4e57';
  const reviewed216 = sha256(canonicalLf(sql)) === '3a30798f8f9dd385dd915ed74b25440b8e40c6b46893541aca049a5b94e09462';
  for (const match of code.matchAll(declaration)) if (/_before_/iu.test(match[1]) &&
    !(existing214ReturnLeaf && match[1] === 'public.package_d_settle_sales_return_before_guard_internal' && /^create\s+or\s+replace\b/iu.test(match[0]))
    && !((reviewed215 || reviewed216) && match[1] === 'public._get_cash_shift_closing_report_before_snapshot' && /^create\s+or\s+replace\b/iu.test(match[0]))) errors.push('NEW_BEFORE_FUNCTION');
  for (const match of code.matchAll(/\balter\s+(?:function|procedure)\b[^;]*?\brename\s+to\s+("(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)/giu))
    if (/_before_/iu.test(match[1]) && !(reviewed215 && ['tb215_finalize_before_exchange_internal','tb215_shift_before_exchange_internal','tb215_completion_before_exchange_internal'].includes(match[1]))) errors.push('NEW_BEFORE_RENAME');
  if (/\bpg_get_functiondef"?\s*\(/iu.test(code)) errors.push('FUNCTION_DEFINITION_INTROSPECTION_IN_MIGRATION');
  // Conservative: REPLACE/regexp_replace + EXECUTE in one migration needs an
  // explicit rewrite, not a text-derived function body. Ordinary data REPLACE
  // without dynamic execution remains permitted; CREATE OR REPLACE is permitted.
  // Privilege declarations (EXECUTE ON) and static trigger declarations
  // (EXECUTE FUNCTION/PROCEDURE) are not dynamic statement execution.
  const dynamicExecute=/\bexecute\b(?!\s+(?:on|function|procedure)\b)/iu;
  if (/\b(?:replace|regexp_replace)"?\s*\(/iu.test(code) && dynamicExecute.test(code)) errors.push('TEXT_PATCH_WITH_DYNAMIC_EXECUTION');
  if (/\bexecute\s+(?:format\s*\()?\s*['"]\s*(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:function|procedure)\b/iu.test(code))
    errors.push('DYNAMIC_FUNCTION_DDL');
  return [...new Set(errors)];
}

export function renderFunctionReference(manifest, functions) {
  const rows = functions.map(row=>({...row,definition:canonicalDefinitionLf(row.definition)}))
    .sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
  const metadata = {format: 1, migrationDigest: manifestDigest(manifest), migrations: manifest,
    functionCount: rows.length, definitionsDigest: sha256(JSON.stringify(rows))};
  const lines = ['# Current public database functions', '',
    '> Generated from an isolated canonical rebuild. Reference only; NOT a migration or a backup.',
    '> No business data, credentials or Production connection. Extension-owned public functions are included.', '',
    `<!-- DB_REFERENCE ${JSON.stringify(metadata)} -->`, '', '## Index', '',
    ...rows.map((row, n) => `- [\`${row.identity}\`](#function-${n + 1})`), ''];
  rows.forEach((row, n) => lines.push(`<a id="function-${n + 1}"></a>`, `## ${row.identity}`, '',
    `Owner: \`${row.owner}\`; security: ${row.securityDefiner ? 'DEFINER' : 'INVOKER'}; volatility: \`${row.volatility}\`.`,
    `Search path/config: \`${JSON.stringify(row.configuration)}\`.`,
    `Effective EXECUTE grants: \`${JSON.stringify(row.executeGrants)}\`.`,
    `Raw ACL: \`${JSON.stringify(row.acl)}\`; extension: \`${row.extension ?? 'none'}\`.`, '',
    '```sql', canonicalLf(row.definition).trimEnd(), '```', ''));
  return lines.join('\n');
}

export function referenceIsFresh(markdown, manifest) {
  const match = markdown.match(/<!-- DB_REFERENCE (.+) -->/u);
  try { const meta = JSON.parse(match?.[1] ?? '');
    return meta.format === 1 && meta.migrationDigest === manifestDigest(manifest)
      && JSON.stringify(meta.migrations) === JSON.stringify(manifest); } catch { return false; }
}
