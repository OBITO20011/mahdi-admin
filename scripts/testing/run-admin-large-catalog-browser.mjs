import {execFile, spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const fixturePath = path.join(here, 'admin-large-catalog-runtime.sql');
const suppliedRoot = process.env.NAWASRAH_LARGE_CATALOG_PROJECT_ROOT;
const projectId = process.env.NAWASRAH_LARGE_CATALOG_PROJECT_ID || 'nawasrah-large-catalog-test';
const skipSeed = process.env.NAWASRAH_SKIP_LARGE_CATALOG_SEED === '1';
const databaseContainer = `supabase_db_${projectId}`;
const email = `large-catalog-${randomUUID()}@example.test`;
const password = `LC-${randomBytes(24).toString('base64url')}!9a`;
const turnstileTestSecret = '1x0000000000000000000000000000000AA';
const vitePort = 4173;
const browserProjects = (process.env.NAWASRAH_LARGE_CATALOG_BROWSER_PROJECTS ||
  'desktop-chromium,mobile-webkit')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const runSql = (userId, sql) => new Promise((resolve, reject) => {
  const psql = spawn('docker', [
    'exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-v', `test_user_id=${userId}`, '-P', 'pager=off',
  ], {cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  psql.stdout.setEncoding('utf8');
  psql.stderr.setEncoding('utf8');
  psql.stdout.on('data', (chunk) => { stdout += chunk; });
  psql.stderr.on('data', (chunk) => { stderr += chunk; });
  psql.on('error', reject);
  psql.on('close', (code) => code === 0
    ? resolve(stdout)
    : reject(new Error(`Large-catalog SQL failed: ${stderr.trim()}`)));
  psql.stdin.end(sql);
});

const runSqlFile = async (userId) => runSql(userId, await readFile(fixturePath, 'utf8'));

const grantTestOwnerAccess = (userId) => runSql(userId, `
INSERT INTO public.profiles (id, full_name, is_active)
VALUES (:'test_user_id'::UUID, 'Large catalog test owner', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO public.user_roles (user_id, role_id)
SELECT :'test_user_id'::UUID, role.id
FROM public.roles role
WHERE role.code = 'owner'
ON CONFLICT DO NOTHING;

-- Supabase-hosted projects add managed object grants alongside migrations.
-- Mirror the authenticated read grant locally; table RLS remains authoritative.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
`);

const waitForHttp = async (url) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(1_000)});
      if (response.ok) return;
    } catch (error) {
      if (attempt === 89) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

let isolatedRoot = suppliedRoot;
let ownsProject = false;
let vite;
try {
  if (!isolatedRoot) {
    const {stdout} = await execFileAsync(process.execPath, [bootstrapPath], {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        NAWASRAH_ISOLATED_PROJECT_ID: projectId,
        TURNSTILE_SECRET: turnstileTestSecret,
      },
    });
    isolatedRoot = JSON.parse(stdout).isolatedProjectRoot;
    ownsProject = true;
  }

  const {stdout: statusOutput} = await execFileAsync(process.execPath, [
    cliPath, 'status', '-o', 'json', '--workdir', isolatedRoot,
  ], {cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024});
  const status = JSON.parse(statusOutput.slice(statusOutput.indexOf('{')));
  const apiUrl = status.API_URL;
  const anonKey = status.ANON_KEY;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error('The isolated large-catalog Supabase status is incomplete.');
  }

  const createUserResponse = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {full_name: 'Large catalog browser owner'},
    }),
  });
  const createdUser = await createUserResponse.json();
  if (!createUserResponse.ok || !createdUser.id) {
    throw new Error('Could not create the isolated large-catalog browser user.');
  }

  if (!skipSeed) {
    const sqlOutput = await runSqlFile(createdUser.id);
    const resultLine = sqlOutput.split(/\r?\n/).find((line) => line.includes('"products": 5000'));
    if (!resultLine) throw new Error('The 5k SQL fixture did not report a passing result.');
  } else {
    await grantTestOwnerAccess(createdUser.id);
  }

  vite = spawn(process.execPath, [
    path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort',
  ], {
    cwd: projectRoot,
    windowsHide: true,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: apiUrl.replace('127.0.0.1', 'localhost'),
      VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
    },
    stdio: 'ignore',
  });
  await waitForHttp(`http://127.0.0.1:${vitePort}`);

  const {stdout: browserOutput} = await execFileAsync(process.execPath, [
    path.join(projectRoot, 'node_modules', 'playwright', 'cli.js'),
    'test', 'e2e/admin-large-catalog-performance.spec.ts',
    ...browserProjects.map((project) => `--project=${project}`), '--workers=1',
  ], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      ADMIN_LARGE_CATALOG_BASE_URL: `http://127.0.0.1:${vitePort}`,
      ADMIN_LARGE_CATALOG_EMAIL: email,
      ADMIN_LARGE_CATALOG_PASSWORD: password,
    },
  });
  process.stdout.write(browserOutput);
  console.log(JSON.stringify({
    ok: true,
    dataset: {products: 5000, balances: 10000, movements: 42000},
    browsers: browserProjects,
    productionWrites: false,
  }, null, 2));
} finally {
  if (vite) vite.kill();
  if (ownsProject && isolatedRoot) {
    await execFileAsync(process.execPath, [
      cliPath, 'stop', '--no-backup', '--workdir', isolatedRoot,
    ], {cwd: projectRoot, windowsHide: true, timeout: 120_000}).catch(() => undefined);
  }
}
