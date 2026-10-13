import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const git = (args, options = {}) => execFileSync('git', args, {cwd: root, encoding: 'utf8', ...options});
const repo = git(['remote', 'get-url', 'origin']).trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/u)?.[1];
assert.ok(repo);
const raw = git(['credential', 'fill'], {input: 'protocol=https\nhost=github.com\n\n', stdio: ['pipe', 'pipe', 'pipe']});
const token = raw.split(/\r?\n/u).find(line => line.startsWith('password='))?.slice(9); assert.ok(token);
const get = async route => {
  const response = await fetch(`https://api.github.com/repos/${repo}/${route}`, {headers: {
    authorization: `Bearer ${token}`, 'user-agent': 'nawasrah-ci-minutes', accept: 'application/vnd.github+json'}});
  assert.ok(response.ok, `GitHub status ${response.status}`); return response.json();
};
async function jobsFor(run) {
  const jobs = [];
  for (let attempt = 1; attempt <= run.run_attempt; attempt++) for (let page = 1; ; page++) {
    const result = await get(`actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100&page=${page}`);
    for (const job of result.jobs) {
      if (job.conclusion !== 'skipped') assert.ok(job.started_at && job.completed_at, 'Incomplete timing evidence');
      const seconds = job.conclusion === 'skipped' ? 0 : (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000;
      assert.ok(Number.isFinite(seconds) && seconds >= 0);
      assert.ok(job.conclusion === 'skipped' || job.labels.some(label => /ubuntu|linux/iu.test(label)), 'Non-Linux runner requires separate billing calculation');
      jobs.push({attempt, name: job.name, conclusion: job.conclusion, startedAt: job.started_at, completedAt: job.completed_at,
        seconds, roundedMinutes: Math.ceil(seconds / 60), labels: job.labels});
    }
    if (result.jobs.length < 100) break;
  }
  return jobs;
}
const {workflow_runs: workflows} = await get('actions/workflows/quality.yml/runs?branch=main&event=push&status=completed&per_page=10');
assert.equal(workflows.length, 10);
const runs = [];
for (const run of workflows) {
  const jobs = await jobsFor(run);
  const {workflow_runs: paired} = await get(`actions/workflows/secrets.yml/runs?head_sha=${run.head_sha}&event=push&per_page=100`);
  const secret = paired.find(value => value.head_branch === 'main' && value.status === 'completed');
  assert.ok(secret, 'Paired secret timing unavailable'); const secretJobs = await jobsFor(secret);
  runs.push({id: run.id, sha: run.head_sha, startedAt: run.run_started_at, conclusion: run.conclusion, attempts: run.run_attempt,
    wallMinutes: (Math.max(...jobs.filter(job => job.attempt === run.run_attempt && job.completedAt).map(job => Date.parse(job.completedAt)))
      - Date.parse(run.run_started_at)) / 60000,
    qualityMinutes: jobs.reduce((sum, job) => sum + job.roundedMinutes, 0),
    secretMinutes: secretJobs.reduce((sum, job) => sum + job.roundedMinutes, 0), secretRun: secret.id, jobs, secretJobs});
  console.log(JSON.stringify({...runs.at(-1), jobs: undefined, secretJobs: undefined}));
}
const minutes = runs.map(run => run.qualityMinutes + run.secretMinutes);
const report = {collectedAt: new Date().toISOString(), method: 'Last10 completed push/main quality runs;all attempts;ceil per standard Linux job;paired secret workflows;excludes uptime/notifications',
  summary: {total: minutes.reduce((a, b) => a + b, 0), mean: minutes.reduce((a, b) => a + b, 0) / 10, max: Math.max(...minutes), min: Math.min(...minutes)}, runs};
if (process.argv[2]) {
  assert.match(process.argv[2], /^docs\/operations\/CI_MINUTES_\d{4}-\d{2}-\d{2}\.json$/u);
  const output = path.join(root, process.argv[2]); await mkdir(path.dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8'); // Mechanical sanitized evidence,not credentials/log bodies.
}
console.log(JSON.stringify(report.summary));
