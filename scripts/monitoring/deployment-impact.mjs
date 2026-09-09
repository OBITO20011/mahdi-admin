import {spawnSync} from 'node:child_process';
import path from 'node:path';

export const DEPLOYMENT_FRESHNESS = Object.freeze({
  CURRENT: 'CURRENT',
  DEPLOYMENT_BEHIND: 'DEPLOYMENT_BEHIND',
  SOURCE_UNRESOLVED: 'SOURCE_UNRESOLVED',
  CLOUDFLARE_UNAVAILABLE: 'CLOUDFLARE_UNAVAILABLE',
});

const ADMIN_WEB_PACKAGES = Object.freeze([
  '@sentry/react',
  '@supabase/supabase-js',
  '@tailwindcss/vite',
  '@vitejs/plugin-react',
  'html5-qrcode',
  'lucide-react',
  'motion',
  'react',
  'react-dom',
  'recharts',
  'tailwindcss',
  'vite',
]);

const normalizeFile = (file) => String(file || '').replaceAll('\\', '/').replace(/^\.\//u, '');
const isAdminStaticPath = (file) => /^(?:src\/|public\/|index\.html$|vite\.config\.ts$|tsconfig\.json$|\.env\.production$|scripts\/deployment\/deploy-admin\.mjs$)/u.test(file);
const isCustomerStaticPath = (file) => /^(?:customer-web\/(?:src\/|public\/|index\.html$|vite\.config\.ts$|tsconfig\.json$|\.env\.production$|scripts\/generate-seo-pages\.mjs$|package(?:-lock)?\.json$))/u.test(file);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function lockPackageName(lockPath) {
  const normalized = normalizeFile(lockPath);
  const marker = 'node_modules/';
  const offset = normalized.lastIndexOf(marker);
  if (offset < 0) return null;
  const tail = normalized.slice(offset + marker.length);
  const parts = tail.split('/');
  return parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] || null;
}

function packageBuildState(manifestText, lockText) {
  const manifest = JSON.parse(manifestText);
  const lock = JSON.parse(lockText);
  const packageEntries = Object.entries(lock.packages || {});
  const byName = new Map();
  for (const [lockPath, entry] of packageEntries) {
    const name = lockPackageName(lockPath);
    if (!name) continue;
    const entries = byName.get(name) || [];
    entries.push([normalizeFile(lockPath), entry]);
    byName.set(name, entries);
  }

  const closure = new Set(ADMIN_WEB_PACKAGES);
  const queue = [...closure];
  while (queue.length > 0) {
    const name = queue.shift();
    for (const [, entry] of byName.get(name) || []) {
      for (const dependency of Object.keys({
        ...(entry.dependencies || {}),
        ...(entry.optionalDependencies || {}),
        ...(entry.peerDependencies || {}),
      })) {
        if (!closure.has(dependency)) {
          closure.add(dependency);
          queue.push(dependency);
        }
      }
    }
  }

  const dependencySpecs = {};
  for (const name of ADMIN_WEB_PACKAGES) {
    dependencySpecs[name] = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? null;
  }
  const lockEntries = packageEntries
    .filter(([lockPath]) => closure.has(lockPackageName(lockPath)))
    .map(([lockPath, entry]) => [normalizeFile(lockPath), {
      version: entry.version || null,
      resolved: entry.resolved || null,
      integrity: entry.integrity || null,
      dependencies: entry.dependencies || {},
      optionalDependencies: entry.optionalDependencies || {},
      peerDependencies: entry.peerDependencies || {},
    }]);
  return stable({
    buildScript: manifest.scripts?.build || null,
    version: manifest.version || null,
    type: manifest.type || null,
    engines: manifest.engines || null,
    packageManager: manifest.packageManager || null,
    dependencySpecs,
    lockEntries,
  });
}

export function adminPackageChangeAffectsBuild(before, after) {
  try {
    const beforeState = packageBuildState(before.manifest, before.lock);
    const afterState = packageBuildState(after.manifest, after.lock);
    return JSON.stringify(beforeState) !== JSON.stringify(afterState);
  } catch {
    return true;
  }
}

export function commitAffectsDeployment(app, files, {adminPackageImpact = false} = {}) {
  const normalized = files.map(normalizeFile);
  if (app === 'admin') {
    return normalized.some((file) => isAdminStaticPath(file)
      || (adminPackageImpact && /^(?:package|package-lock)\.json$/u.test(file)));
  }
  if (app === 'customer') return normalized.some(isCustomerStaticPath);
  throw new Error(`Unsupported deployment application: ${app}`);
}

export function expectedDeploymentFromCommits({app, deployedSha, mainSha, commits}) {
  if (!deployedSha || !mainSha) {
    return {status: DEPLOYMENT_FRESHNESS.SOURCE_UNRESOLVED, expectedSha: null, relevantCommit: null};
  }
  if (deployedSha === mainSha) {
    return {status: DEPLOYMENT_FRESHNESS.CURRENT, expectedSha: deployedSha, relevantCommit: null};
  }
  const relevantCommit = commits.find((commit) => commitAffectsDeployment(app, commit.files, {
    adminPackageImpact: commit.adminPackageImpact === true,
  }));
  return relevantCommit
    ? {status: DEPLOYMENT_FRESHNESS.DEPLOYMENT_BEHIND, expectedSha: relevantCommit.sha, relevantCommit}
    : {status: DEPLOYMENT_FRESHNESS.CURRENT, expectedSha: deployedSha, relevantCommit: null};
}

function gitCommand(projectRoot, args) {
  const executable = process.platform === 'win32' ? 'git.exe' : 'git';
  const root = path.resolve(projectRoot);
  const result = spawnSync(executable, ['-c', `safe.directory=${root}`, '-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
  };
}

export function resolveRepositoryMainSha(projectRoot) {
  if (!projectRoot) return {sha: '', source: 'unavailable'};
  const remote = gitCommand(projectRoot, ['ls-remote', 'origin', 'refs/heads/main']);
  const remoteSha = remote.ok ? remote.stdout.split(/\s+/u)[0] || '' : '';
  if (/^[a-f0-9]{40}$/u.test(remoteSha)) return {sha: remoteSha, source: 'origin'};
  for (const reference of ['refs/remotes/origin/main', 'refs/heads/main']) {
    const local = gitCommand(projectRoot, ['rev-parse', `${reference}^{commit}`]);
    if (local.ok && /^[a-f0-9]{40}$/u.test(local.stdout)) return {sha: local.stdout, source: reference};
  }
  return {sha: '', source: 'unavailable'};
}

function showFile(projectRoot, revision, file) {
  const result = gitCommand(projectRoot, ['show', `${revision}:${file}`]);
  return result.ok ? result.stdout : null;
}

function packageImpactForCommit(projectRoot, commitSha) {
  const parentResult = gitCommand(projectRoot, ['rev-list', '--parents', '-n', '1', commitSha]);
  if (!parentResult.ok) return true;
  const [, parentSha] = parentResult.stdout.split(/\s+/u);
  if (!parentSha) return true;
  const beforeManifest = showFile(projectRoot, parentSha, 'package.json');
  const beforeLock = showFile(projectRoot, parentSha, 'package-lock.json');
  const afterManifest = showFile(projectRoot, commitSha, 'package.json');
  const afterLock = showFile(projectRoot, commitSha, 'package-lock.json');
  if (![beforeManifest, beforeLock, afterManifest, afterLock].every((value) => typeof value === 'string')) return true;
  return adminPackageChangeAffectsBuild(
    {manifest: beforeManifest, lock: beforeLock},
    {manifest: afterManifest, lock: afterLock},
  );
}

export function resolveDeploymentFreshness({projectRoot, app, deployedSha, mainSha}) {
  if (!projectRoot) {
    return {status: DEPLOYMENT_FRESHNESS.SOURCE_UNRESOLVED, expectedSha: null, relevantCommit: null, reason: 'project-root-missing'};
  }
  if (!/^[a-f0-9]{40}$/u.test(deployedSha || '')) {
    return {status: DEPLOYMENT_FRESHNESS.SOURCE_UNRESOLVED, expectedSha: null, relevantCommit: null, reason: 'deployed-sha-invalid'};
  }
  if (!/^[a-f0-9]{40}$/u.test(mainSha || '')) {
    return {status: DEPLOYMENT_FRESHNESS.SOURCE_UNRESOLVED, expectedSha: null, relevantCommit: null, reason: 'main-sha-invalid'};
  }
  if (deployedSha === mainSha) {
    return {status: DEPLOYMENT_FRESHNESS.CURRENT, expectedSha: deployedSha, relevantCommit: null};
  }
  for (const sha of [deployedSha, mainSha]) {
    if (!gitCommand(projectRoot, ['cat-file', '-e', `${sha}^{commit}`]).ok) {
      return {status: DEPLOYMENT_FRESHNESS.SOURCE_UNRESOLVED, expectedSha: null, relevantCommit: null, reason: sha === deployedSha ? 'deployed-object-unavailable' : 'main-object-unavailable'};
    }
  }
  const ancestor = gitCommand(projectRoot, ['merge-base', '--is-ancestor', deployedSha, mainSha]);
  if (!ancestor.ok) {
    return {status: DEPLOYMENT_FRESHNESS.SOURCE_UNRESOLVED, expectedSha: null, relevantCommit: null, reason: ancestor.status === 1 ? 'deployment-not-ancestor' : 'ancestor-check-unavailable'};
  }
  const history = gitCommand(projectRoot, ['rev-list', '--topo-order', `${deployedSha}..${mainSha}`]);
  if (!history.ok) {
    return {status: DEPLOYMENT_FRESHNESS.SOURCE_UNRESOLVED, expectedSha: null, relevantCommit: null, reason: 'history-unavailable'};
  }
  const commits = [];
  for (const sha of history.stdout.split(/\r?\n/u).filter(Boolean)) {
    const diff = gitCommand(projectRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', sha]);
    if (!diff.ok) {
      return {status: DEPLOYMENT_FRESHNESS.SOURCE_UNRESOLVED, expectedSha: null, relevantCommit: null, reason: 'commit-diff-unavailable'};
    }
    const files = [...new Set(diff.stdout.split(/\r?\n/u).filter(Boolean))];
    const hasRootPackageChange = app === 'admin' && files.some((file) => /^(?:package|package-lock)\.json$/u.test(normalizeFile(file)));
    commits.push({
      sha,
      files,
      adminPackageImpact: hasRootPackageChange ? packageImpactForCommit(projectRoot, sha) : false,
    });
  }
  return expectedDeploymentFromCommits({app, deployedSha, mainSha, commits});
}

export function evaluateCloudflareDeployment({cloudflareAvailable, projectRoot, app, deployedSha, mainSha}) {
  if (!cloudflareAvailable) {
    return {status: DEPLOYMENT_FRESHNESS.CLOUDFLARE_UNAVAILABLE, expectedSha: null, relevantCommit: null};
  }
  return resolveDeploymentFreshness({projectRoot, app, deployedSha, mainSha});
}
