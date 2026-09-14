import type { Factor } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import {
  MfaStatusRecoveryExhaustedError,
  MfaStatusStaleAttemptError,
  MfaStatusTimeoutError,
  MfaStatusAttempt,
  RecoverableMfaStatusRequest,
} from './mfaStatusRequest';

export interface MfaStatus {
  verifiedTotpFactor: Factor<'totp', 'verified'> | null;
  unverifiedTotpFactors: Factor[];
  currentLevel: string | null;
  nextLevel: string | null;
}

export interface TotpEnrollment {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}

function requireSupabase() {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('تكوين Supabase غير مكتمل.');
  }

  return supabase;
}

function normalizeTotpCode(code: string): string {
  const normalized = code.replace(/\D/g, '').slice(0, 6);

  if (!/^\d{6}$/.test(normalized)) {
    throw new Error('أدخل رمز التحقق المكوّن من 6 أرقام.');
  }

  return normalized;
}

export function translateMfaError(error: unknown): string {
  if (error instanceof MfaStatusRecoveryExhaustedError) {
    return 'تعذر استعادة فحص المصادقة بأمان. أعد تحميل صفحة النظام ثم حاول مجددًا.';
  }

  if (error instanceof MfaStatusTimeoutError) {
    return 'استغرق فحص حالة المصادقة وقتًا أطول من المتوقع. حاول مجددًا.';
  }

  if (error instanceof MfaStatusStaleAttemptError) {
    return 'تغيّرت جلسة الدخول أثناء فحص المصادقة. حاول مجددًا.';
  }

  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  if (normalized.includes('invalid totp') || normalized.includes('invalid verification code')) {
    return 'رمز تطبيق المصادقة غير صحيح أو انتهت صلاحيته. جرّب الرمز الجديد.';
  }

  if (normalized.includes('challenge expired')) {
    return 'انتهت مهلة رمز التحقق. أدخل الرمز الجديد الظاهر في التطبيق.';
  }

  if (normalized.includes('aal2')) {
    return 'يجب تأكيد رمز تطبيق المصادقة قبل تنفيذ هذه العملية.';
  }

  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'تعذر الاتصال بخادم المصادقة. تحقق من الإنترنت وحاول مجددًا.';
  }

  return 'تعذر إكمال التحقق بخطوتين. حاول مجددًا.';
}

const mfaStatusLoader = new RecoverableMfaStatusRequest<MfaStatus>();

async function readMfaSessionIdentity(): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session?.user.id) throw new MfaStatusStaleAttemptError();

  // Bind results without retaining access tokens or refresh tokens.
  return JSON.stringify([
    data.session.user.id,
    data.session.user.last_sign_in_at || null,
    data.session.expires_at || null,
  ]);
}

async function assertSameMfaSession(
  expectedIdentity: string,
  attempt: MfaStatusAttempt
): Promise<void> {
  attempt.assertCurrent();
  const currentIdentity = await readMfaSessionIdentity();
  attempt.assertCurrent();
  if (currentIdentity !== expectedIdentity) throw new MfaStatusStaleAttemptError();
}

async function loadMfaStatus(attempt: MfaStatusAttempt): Promise<MfaStatus> {
  const client = requireSupabase();
  const sessionIdentity = await readMfaSessionIdentity();
  attempt.assertCurrent();
  const factorsResponse = await client.auth.mfa.listFactors();

  if (factorsResponse.error) throw factorsResponse.error;

  // GoTrue auth calls share session state. Keep the status probe sequential so
  // the SDK never performs two MFA reads against that state at the same time.
  // A timed-out generation must not start this second SDK request when its
  // first request eventually settles.
  await assertSameMfaSession(sessionIdentity, attempt);
  const aalResponse = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalResponse.error) throw aalResponse.error;
  await assertSameMfaSession(sessionIdentity, attempt);

  return {
    verifiedTotpFactor: factorsResponse.data.totp[0] || null,
    unverifiedTotpFactors: factorsResponse.data.all.filter(
      (factor) => factor.factor_type === 'totp' && factor.status === 'unverified'
    ),
    currentLevel: aalResponse.data.currentLevel,
    nextLevel: aalResponse.data.nextLevel,
  };
}

export function getMfaStatus(): Promise<MfaStatus> {
  return mfaStatusLoader.run(loadMfaStatus);
}

export async function beginTotpEnrollment(): Promise<TotpEnrollment> {
  const client = requireSupabase();
  const status = await getMfaStatus();

  if (status.verifiedTotpFactor) {
    throw new Error('المصادقة الثنائية مفعلة بالفعل على هذا الحساب.');
  }

  // Supabase keeps cancelled enrollment attempts as unverified factors.
  // Removing only those stale factors prevents duplicate QR setups.
  for (const factor of status.unverifiedTotpFactors) {
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
    if (error) throw error;
  }

  const { data, error } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Nawasrah Authenticator',
    issuer: 'Nawasrah ERP',
  });

  if (error) throw error;

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

export async function verifyTotpFactor(factorId: string, code: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.auth.mfa.challengeAndVerify({
    factorId,
    code: normalizeTotpCode(code),
  });

  if (error) throw error;
}

export async function removeTotpFactor(factorId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.auth.mfa.unenroll({ factorId });

  if (error) throw error;
}
