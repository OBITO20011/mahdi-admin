import path from 'node:path';

export const PRIVATE_CI_VARIABLE = 'PRIVATE_CI_BUDGET_MODE';
export function ciRoute({flag, isPrivate, event}) {
  const enabled = flag === 'true' && isPrivate === true;
  if (event === 'schedule' && !enabled) return 'disabled';
  return enabled && ['push', 'pull_request'].includes(event) ? 'affected' : 'full';
}

const sourceExtensions = ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.css', '.html', '.json'];
const normalize = file => file.replaceAll('\\', '/').replace(/^\.\//u, '');
export const isPackageFSpec = file => /(?:^|\/)package-f-[^/]+\.spec\.ts$/u.test(file);

// Resolve literal imports AND runtime harness/HTML links. Unresolved local
// paths / computed runtime imports fall back to the complete browser set.
/**
 * @param {Record<string,string>} files
 * @param {string[]} changed
 * @param {{typescript?:typeof import('typescript')|null,discoveredSpecs?:string[]|null}} [options]
 */
export function selectAffectedSpecs(files, changed, {typescript: ts = null, discoveredSpecs = null} = {}) {
  const entries = new Map(Object.entries(files).map(([name, content]) => [normalize(name), content]));
  const specs = discoveredSpecs ? discoveredSpecs.map(normalize).sort()
    : [...entries.keys()].filter(name => /^e2e\/.*\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(name)).sort();
  const packages = new Set();
  for (const name of ['package.json', 'customer-web/package.json']) {
    if (entries.has(name)) { const value = JSON.parse(entries.get(name));
      for (const packageName of Object.keys({...value.dependencies, ...value.devDependencies})) packages.add(packageName); }
  }
  const resolve = (from, value) => {
    if (/^\/node_modules\//u.test(value)) return null;
    let base;
    if (value.startsWith('/')) base = value.slice(1);
    else if (value.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), value));
    else if (value.startsWith('@/')) base = 'src/' + value.slice(2);
    else {
      const packageName = value.startsWith('@') ? value.split('/').slice(0, 2).join('/') : value.split('/')[0];
      return value.startsWith('node:') || packages.has(packageName) ? null : false; // Unknown alias is NOT guessed external.
    }
    base = base.split(/[?#]/u)[0];
    return [base, ...sourceExtensions.map(ext => base + ext), ...sourceExtensions.map(ext => base + '/index' + ext)]
      .find(candidate => entries.has(candidate)) ?? false;
  };
  const graph = new Map(), uncertainFiles = new Set();
  // Optional real TS binding analysis: a const literal runtime import is known;
  // a parameter/shadowed/computed value is NOT guessed from a same-named const.
  let checker, program;
  if (ts) {
    const codeFiles = [...entries.keys()].filter(file => /\.(?:tsx?|m?js|jsx)$/u.test(file));
    const host = ts.createCompilerHost({});
    host.getCurrentDirectory = () => '/repo';
    host.getSourceFile = (file, version) => { const name = normalize(file).replace(/^\/repo\//u, '');
      return entries.has(name) ? ts.createSourceFile(file, entries.get(name), version, true) : undefined; };
    host.fileExists = file => entries.has(normalize(file).replace(/^\/repo\//u, ''));
    host.readFile = file => entries.get(normalize(file).replace(/^\/repo\//u, ''));
    program = ts.createProgram(codeFiles.map(file => '/repo/' + file), {allowJs: true, noResolve: true, noLib: true, jsx: ts.JsxEmit.Preserve}, host);
    checker = program.getTypeChecker();
  }
  for (const [file, content] of entries) {
    const edges = new Set();
    const literals = [...content.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\bimport\s*|\brequire\s*\(|\bsrc\s*=\s*|\bhref\s*=\s*)['"]([^'"\n]+)['"]/gu)]
      .map(match => match[1]);
    // page.goto('/e2e/foo.html') and dynamically imported /src modules.
    literals.push(...[...content.matchAll(/['"`]((?:\.?\.?\/|\/)(?:[^'"`\n]*)\.(?:html|tsx?|m?js|css)(?:\?[^'"`\n]*)?)['"`]/gu)].map(match => match[1]));
    for (const literal of literals) {
      const target = resolve(file, literal);
      if (target) edges.add(target);
      else if (target === false && /^(src|customer-web\/src|e2e)\//u.test(file)
        && !/\.(?:png|jpg|svg|webp|woff2?|ico)$/u.test(literal)) uncertainFiles.add(file);
    }
    if (/^(?:src|customer-web\/src|e2e)\//u.test(file)) {
      const source = program?.getSourceFile('/repo/' + file);
      if (source) {
        const visit = node => {
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const arg = node.arguments[0]; let value;
            if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) value = arg.text;
            else if (arg && ts.isIdentifier(arg)) {
              const declaration = checker.getSymbolAtLocation(arg)?.valueDeclaration;
              if (declaration && ts.isVariableDeclaration(declaration) && (declaration.parent.flags & ts.NodeFlags.Const)
                && declaration.initializer && (ts.isStringLiteral(declaration.initializer) || ts.isNoSubstitutionTemplateLiteral(declaration.initializer)))
                value = declaration.initializer.text;
            }
            if (value === undefined) uncertainFiles.add(file);
            else { const target = resolve(file, value); if (target) edges.add(target); else if (target === false) uncertainFiles.add(file); }
          }
          ts.forEachChild(node, visit);
        }; visit(source);
      } else if (/\bimport\s*\(\s*[^'"\s]/u.test(content)) uncertainFiles.add(file);
    }
    // Tests navigating the normal app use the complete app entry graph.
    if (file.endsWith('.spec.ts') && /\.goto\(\s*['"]\/(?:[?'"])/u.test(content)) {
      for (const entry of ['index.html', 'customer-web/index.html']) if (entries.has(entry)) edges.add(entry);
    }
    graph.set(file, edges);
  }
  const relevant = changed.map(normalize).filter(file => !/^(?:docs\/|\.claude\/)/u.test(file) && !/\.md$/u.test(file));
  if (!relevant.length) return {files: [], reason: 'docs-only'};
  if (relevant.some(file => !/^(?:src\/|customer-web\/src\/|e2e\/)/u.test(file)))
    return {files: specs, reason: 'shared-config-backend-tooling-or-unknown'};
  const selected = new Set();
  for (const spec of specs) {
    const seen = new Set(), visit = file => {
      if (seen.has(file)) return; seen.add(file); for (const dep of graph.get(file) ?? []) visit(dep);
    }; visit(spec);
    if (relevant.some(file => seen.has(file)) || [...seen].some(file => uncertainFiles.has(file))) selected.add(spec);
  }
  // Deleted/renamed files, new unreferenced app modules or unusual routes cannot
  // silently lose coverage. Conservative fallback,never a time-budget skip.
  if (relevant.some(file => ![...selected].some(spec => {
    const seen = new Set(), visit = node => { if (seen.has(node)) return; seen.add(node); for (const dep of graph.get(node) ?? []) visit(dep); };
    visit(spec); return seen.has(file);
  }))) return {files: specs, reason: 'unmapped-change'};
  return {files: [...selected].sort(), reason: 'transitive-dependency-closure'};
}

export function verifyCiBranches(needs, route) {
  if (!['full', 'affected'].includes(route.mode) || typeof route.packageFNeeded !== 'boolean') throw new Error('Invalid CI route');
  const required = ['scope', 'quality', 'package-f-browser', 'database-runtime', 'current-database-runtime'];
  if (Object.keys(needs).sort().join() !== [...required].sort().join()) throw new Error('CI branch inventory differs');
  for (const name of required) {
    const expected = route.mode === 'full' || name === 'scope' || name === 'quality'
      || (name === 'package-f-browser' && route.packageFNeeded) ? 'success' : 'skipped';
    if (needs[name]?.result !== expected) throw new Error(`CI branch ${name}: expected ${expected}`);
  }
}
