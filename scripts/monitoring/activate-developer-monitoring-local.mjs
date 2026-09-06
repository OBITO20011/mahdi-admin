import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {homedir} from 'node:os';
import path from 'node:path';

const accountId = '5900838df9d3a9408d17a9f1c4538b2b';
const nonce = randomBytes(32).toString('hex');
const timeoutMs = 5 * 60 * 1000;

function runPowerShell(script, stdin = '') {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Secure Windows helper failed with exit code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(stdin);
  });
}

async function protectMachine(value) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
try {
  $protected = [Security.Cryptography.ProtectedData]::Protect(
    $bytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  [Console]::Out.Write([Convert]::ToBase64String($protected))
}
finally { [Array]::Clear($bytes, 0, $bytes.Length) }
`;
  return runPowerShell(script, value);
}

async function restrictEnvelope(pathname) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$path = [Console]::In.ReadToEnd()
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$admins = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$acl = [Security.AccessControl.FileSecurity]::new()
$acl.SetOwner($user)
$acl.SetAccessRuleProtection($true, $false)
foreach ($identity in @($user, $system, $admins)) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $identity,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  ))
}
[System.IO.File]::SetAccessControl($path, $acl)
`;
  await runPowerShell(script, pathname);
}

function html(message = '') {
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>تفعيل مراقبة النواصرة</title><style>body{font-family:system-ui;max-width:36rem;margin:3rem auto;padding:1rem}label{display:block;margin:1rem 0}.secret{width:100%;min-height:44px}button{min-height:44px;padding:.7rem 1.2rem}</style><h1>تفعيل تنبيهات المطور</h1><p>القيم تُرسل إلى 127.0.0.1 فقط، وتُشفّر فورًا بـDPAPI ولا تُسجل.</p>${message ? `<p role="status">${message}</p>` : ''}<form method="post" action="/activate" autocomplete="off"><input type="hidden" name="nonce" value="${nonce}"><label>Telegram Bot Token<input class="secret" name="telegramToken" type="password" required></label><label>Cloudflare Read-only Token<input class="secret" name="cloudflareToken" type="password" required></label><button type="submit">تحقق وشفر الإعداد</button></form></html>`;
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
  if (request.method === 'GET') {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.searchParams.get('nonce') !== nonce) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html());
    return;
  }
  if (request.method !== 'POST' || request.url !== '/activate') {
    response.writeHead(404).end('Not found');
    return;
  }

  let raw = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 8192) request.destroy();
  });
  request.once('end', async () => {
    try {
      const form = new URLSearchParams(raw);
      if (form.get('nonce') !== nonce) throw new Error('Activation nonce is invalid.');
      const telegramToken = form.get('telegramToken')?.trim() || '';
      const cloudflareToken = form.get('cloudflareToken')?.trim() || '';
      if (!/^\d+:[A-Za-z0-9_-]{20,}$/u.test(telegramToken)) throw new Error('Telegram token is invalid.');
      if (cloudflareToken.length < 40) throw new Error('Cloudflare token is invalid.');

      const [getMeResponse, updatesResponse] = await Promise.all([
        fetch(`https://api.telegram.org/bot${telegramToken}/getMe`, {signal: AbortSignal.timeout(15000)}),
        fetch(`https://api.telegram.org/bot${telegramToken}/getUpdates`, {signal: AbortSignal.timeout(15000)}),
      ]);
      const [getMe, updates] = await Promise.all([getMeResponse.json(), updatesResponse.json()]);
      if (!getMeResponse.ok || getMe.ok !== true || getMe.result?.username !== 'NawasrahDeveloperAlertsBot') {
        throw new Error('Developer Telegram bot validation failed.');
      }
      const privateChats = new Map();
      for (const update of updates.result || []) {
        const chat = update.message?.chat;
        if (chat?.type === 'private') privateChats.set(String(chat.id), chat);
      }
      if (privateChats.size !== 1) throw new Error('Exactly one private developer chat must send /start to the bot.');
      const telegramChatId = [...privateChats.keys()][0];

      for (const project of ['nawasrah-admin', 'nawasrah-store']) {
        const check = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}`, {
          headers: {Authorization: `Bearer ${cloudflareToken}`},
          signal: AbortSignal.timeout(20000),
        });
        const payload = await check.json();
        if (!check.ok || payload.success !== true) throw new Error(`Cloudflare read-only validation failed for ${project}.`);
      }

      const envelopeRoot = path.join(homedir(), 'AppData', 'Local', 'NawasrahDeveloperMonitoring');
      await mkdir(envelopeRoot, {recursive: true});
      const envelopePath = path.join(envelopeRoot, `activation-envelope-${randomBytes(12).toString('hex')}.json`);
      const envelope = {
        formatVersion: 1,
        protectionScope: 'LocalMachine',
        telegramBotToken: await protectMachine(telegramToken),
        telegramChatId,
        cloudflareApiToken: await protectMachine(cloudflareToken),
        cloudflareAccountId: accountId,
      };
      await writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
      await restrictEnvelope(envelopePath);

      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html('تم التحقق والتشفير بنجاح. يمكنك إغلاق هذه الصفحة.'));
      console.log(`CREDENTIAL_ENVELOPE=${envelopePath}`);
      server.close();
    } catch (error) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html('فشل التحقق الآمن. لم يتم حفظ أي إعداد.'));
      console.error(`ACTIVATION_FAILED=${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      raw = '';
    }
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  console.log(`ACTIVATION_URL=http://127.0.0.1:${address.port}/?nonce=${nonce}`);
});

const timer = setTimeout(() => {
  console.error('ACTIVATION_FAILED=Timed out waiting for local credential handoff.');
  server.close();
}, timeoutMs);
timer.unref();
