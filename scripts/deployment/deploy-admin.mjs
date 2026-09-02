import { execFileSync, spawnSync } from 'node:child_process';

const checkOnly = process.argv.includes('--check');
const npmCliPath = process.env.npm_execpath;

if (!npmCliPath) {
  throw new Error('Run this deployment through npm run deploy:admin.');
}

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

const branch = git('branch', '--show-current');
if (branch !== 'main') {
  throw new Error(`Admin production deployment requires branch main; current branch is ${branch || 'detached HEAD'}.`);
}

if (git('status', '--porcelain')) {
  throw new Error('Admin production deployment requires a clean working tree.');
}

const localSha = git('rev-parse', 'HEAD');
const remoteMain = git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0];
if (!remoteMain || localSha !== remoteMain) {
  throw new Error(`Local HEAD (${localSha}) does not match origin/main (${remoteMain || 'missing'}).`);
}

const commitMessage = git('show', '-s', '--format=%s', localSha);
console.log(`Verified admin release source: main@${localSha}`);

if (checkOnly) {
  console.log('Admin deployment traceability check passed.');
  process.exit(0);
}

run(process.execPath, [npmCliPath, 'run', 'build']);
run(process.execPath, [
  npmCliPath,
  'exec',
  '--yes',
  'wrangler',
  '--',
  'pages',
  'deploy',
  'dist',
  '--project-name=nawasrah-admin',
  '--branch=main',
  `--commit-hash=${localSha}`,
  `--commit-message=${commitMessage}`,
]);

console.log(`Admin deployment completed from main@${localSha}.`);
