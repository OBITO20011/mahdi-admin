import {execFile, spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = 'nawasrah-admin-session-test';
const databaseContainer = `supabase_db_${projectId}`;
const vitePort = 4173;
const email = `session-${randomUUID()}@example.test`;
const password = `T-${randomBytes(24).toString('base64url')}!9a`;
const turnstileTestSecret = '1x0000000000000000000000000000000AA';

const runSql = (sql) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
  ], {cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => code === 0
    ? resolve(stdout.trim())
    : reject(new Error(`Isolated Admin session SQL failed: ${stderr.trim()}`)));
  child.stdin.end(sql);
});

const waitForHttp = async (url) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(1_000)});
      if (response.ok) return;
    } catch (error) {
      if (attempt === 59) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}.`);
};

let isolatedProjectRoot;
let vite;
try {
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
  const bootstrap = JSON.parse(stdout);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;

  const {stdout: statusOutput} = await execFileAsync(process.execPath, [
    cliPath, 'status', '-o', 'json', '--workdir', isolatedProjectRoot,
  ], {cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024});
  const status = JSON.parse(statusOutput);
  const apiUrl = status.API_URL || status.api_url;
  const anonKey = status.ANON_KEY || status.anon_key;
  const serviceRoleKey = status.SERVICE_ROLE_KEY || status.service_role_key;
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error('The isolated Admin auth configuration is incomplete.');
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
      user_metadata: {full_name: 'Isolated session Admin'},
    }),
  });
  const createdUser = await createUserResponse.json();
  if (!createUserResponse.ok || !createdUser.id) {
    throw new Error('Could not create the isolated Admin session user.');
  }

  await runSql(`
INSERT INTO public.profiles (id, full_name, is_active)
VALUES ('${createdUser.id}'::uuid, 'Isolated session Admin', true)
ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name, is_active=true;

INSERT INTO public.user_roles (user_id, role_id)
SELECT '${createdUser.id}'::uuid, id FROM public.roles WHERE code='admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Supabase-hosted projects apply managed object-level grants in addition to
-- repository migrations. Mirror only the authenticated read grant needed by
-- this browser test; RLS remains enabled and authoritative on every table.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
  `);

  const baseline = await runSql(`SELECT json_build_object(
    'orders', (SELECT COUNT(*) FROM public.orders),
    'movements', (SELECT COUNT(*) FROM public.inventory_movements),
    'receipts', (SELECT COUNT(*) FROM public.supplier_receipts)
  );`);

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

  await execFileAsync(process.execPath, [
    path.join(projectRoot, 'node_modules', 'playwright', 'cli.js'),
    'test', 'e2e/admin-session-integrated-isolated.spec.ts',
    '--project=desktop-chromium', '--project=mobile-webkit', '--workers=1',
  ], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      ADMIN_SESSION_E2E_BASE_URL: `http://127.0.0.1:${vitePort}`,
      ADMIN_SESSION_E2E_EMAIL: email,
      ADMIN_SESSION_E2E_PASSWORD: password,
    },
  });

  const after = await runSql(`SELECT json_build_object(
    'orders', (SELECT COUNT(*) FROM public.orders),
    'movements', (SELECT COUNT(*) FROM public.inventory_movements),
    'receipts', (SELECT COUNT(*) FROM public.supplier_receipts)
  );`);
  if (after !== baseline) {
    throw new Error('The isolated Admin session E2E changed business data.');
  }

  console.log(JSON.stringify({
    ok: true,
    browsers: ['desktop-chromium', 'mobile-webkit'],
    realSupabaseAuth: true,
    realProfileAndRoleRls: true,
    productionWrites: false,
    businessDataUnchanged: true,
  }, null, 2));
} finally {
  vite?.kill();
  if (isolatedProjectRoot) {
    await execFileAsync(process.execPath, [
      cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot,
    ], {cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024})
      .catch(() => undefined);
  }
}
