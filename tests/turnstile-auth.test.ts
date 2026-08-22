import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const loginView = readFileSync('src/features/auth/LoginView.tsx', 'utf8');
const biometricLock = readFileSync(
  'src/components/layout/IPhoneContainer.tsx',
  'utf8',
);
const authStore = readFileSync('src/stores/useAuthStore.ts', 'utf8');
const turnstileWidget = readFileSync(
  'src/features/auth/TurnstileWidget.tsx',
  'utf8',
);
const publicConfig = readFileSync(
  'src/config/supabase-public-config.ts',
  'utf8',
);
const headers = readFileSync('public/_headers', 'utf8');
const supabaseConfig = readFileSync('supabase/config.toml', 'utf8');

test('every password sign-in requires a fresh Turnstile token', () => {
  assert.match(loginView, /signIn\(email, password, captchaToken\)/);
  assert.match(loginView, /disabled=\{isSubmitting \|\| !captchaToken\}/);
  assert.match(loginView, /setCaptchaResetKey\(\(current\) => current \+ 1\)/);

  assert.match(
    biometricLock,
    /signIn\(passwordEmail, password, passwordCaptchaToken\)/,
  );
  assert.match(biometricLock, /!passwordCaptchaToken/);
  assert.match(
    biometricLock,
    /setPasswordCaptchaResetKey\(\(current\) => current \+ 1\)/,
  );
});

test('Supabase receives the token for server-side verification', () => {
  assert.match(authStore, /captchaToken: string/);
  assert.match(authStore, /options: \{ captchaToken \}/);
  assert.match(supabaseConfig, /\[auth\.captcha\]/);
  assert.match(supabaseConfig, /enabled = true/);
  assert.match(supabaseConfig, /provider = "turnstile"/);
  assert.match(supabaseConfig, /secret = "env\(TURNSTILE_SECRET\)"/);
  assert.doesNotMatch(supabaseConfig, /0x[A-Za-z0-9_-]{20,}/);
});

test('Turnstile widget is explicit, Arabic, resettable, and CSP-approved', () => {
  assert.match(turnstileWidget, /render=explicit/);
  assert.match(turnstileWidget, /action: 'admin_login'/);
  assert.match(turnstileWidget, /language: 'ar'/);
  assert.match(turnstileWidget, /turnstile\.reset/);
  assert.match(turnstileWidget, /expired-callback/);
  assert.match(turnstileWidget, /error-callback/);

  assert.match(headers, /script-src[^\n]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(headers, /frame-src[^\n]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(headers, /connect-src[^\n]*https:\/\/challenges\.cloudflare\.com/);
});

test('only the public Turnstile site key is shipped to the browser', () => {
  assert.match(publicConfig, /TURNSTILE_SITE_KEY/);
  assert.match(publicConfig, /0x4AAAAAAEPJTplD4PVe_Cgk/);
  assert.doesNotMatch(publicConfig, /TURNSTILE_SECRET/);
  assert.equal((publicConfig.match(/TURNSTILE_[A-Z_]+\s*:/g) || []).length, 1);
});
