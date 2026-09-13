import type { Factor } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import {
  MfaStatusTimeoutError,
  SingleFlightRequest,
  withMfaStatusTimeout,
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
  if (error instanceof MfaStatusTimeoutError) {
    return 'استغرق فحص حالة المصادقة وقتًا أطول من المتوقع. حاول مجددًا.';
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

const mfaStatusLoader = new SingleFlightRequest<MfaStatus>();

async function loadMfaStatus(): Promise<MfaStatus> {
  const client = requireSupabase();
  const factorsResponse = await client.auth.mfa.listFactors();

  if (factorsResponse.error) throw factorsResponse.error;

  // GoTrue auth calls share session state. Keep the status probe sequential so
  // the SDK never performs two MFA reads against that state at the same time.
  const aalResponse = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalResponse.error) throw aalResponse.error;

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
  // Keep the underlying SDK call single-flight even after a caller times out.
  // A retry receives a fresh timeout window around the same in-flight request.
  return withMfaStatusTimeout(mfaStatusLoader.run(loadMfaStatus));
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
