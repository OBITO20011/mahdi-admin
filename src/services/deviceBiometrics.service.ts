const BIOMETRIC_CREDENTIAL_PREFIX = 'nawasrah_biometric_credential_v1:';

type BiometricFailureCode =
  | 'unsupported'
  | 'not_registered'
  | 'cancelled'
  | 'failed';

export interface DeviceBiometricResult {
  success: boolean;
  code?: BiometricFailureCode;
  error?: string;
}

function getCredentialStorageKey(userId: string) {
  return `${BIOMETRIC_CREDENTIAL_PREFIX}${userId}`;
}

function bytesToBase64Url(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(value.length / 4) * 4,
    '='
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomChallenge() {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  return challenge;
}

function mapCredentialError(error: unknown): DeviceBiometricResult {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      return {
        success: false,
        code: 'cancelled',
        error: 'تم إلغاء التحقق أو انتهت مهلة بصمة الجهاز.',
      };
    }

    if (error.name === 'InvalidStateError') {
      return {
        success: false,
        code: 'failed',
        error: 'بصمة هذا الجهاز مسجلة مسبقاً. أعد المحاولة بعد تحديث الصفحة.',
      };
    }
  }

  return {
    success: false,
    code: 'failed',
    error: error instanceof Error ? error.message : 'تعذر استخدام بصمة الجهاز.',
  };
}

export async function isDeviceBiometricAvailable() {
  if (
    typeof window === 'undefined' ||
    !window.isSecureContext ||
    !('PublicKeyCredential' in window) ||
    !navigator.credentials
  ) {
    return false;
  }

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function hasRegisteredDeviceBiometric(userId: string) {
  if (!userId || typeof localStorage === 'undefined') {
    return false;
  }

  return Boolean(localStorage.getItem(getCredentialStorageKey(userId)));
}

export function removeRegisteredDeviceBiometric(userId: string) {
  if (!userId || typeof localStorage === 'undefined') {
    return;
  }

  localStorage.removeItem(getCredentialStorageKey(userId));
}

export async function registerDeviceBiometric(
  userId: string,
  displayName: string
): Promise<DeviceBiometricResult> {
  if (!(await isDeviceBiometricAvailable())) {
    return {
      success: false,
      code: 'unsupported',
      error:
        'بصمة الجهاز غير متاحة هنا. افتح التطبيق من iPhone عبر اتصال آمن أو استخدم جهازاً يدعم Face ID أو Windows Hello.',
    };
  }

  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: {
          name: 'Nawasrah Business Manager',
        },
        user: {
          id: new TextEncoder().encode(userId),
          name: userId,
          displayName: displayName || 'مستخدم النواصرة',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required',
        },
        attestation: 'none',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;

    if (!credential) {
      return {
        success: false,
        code: 'failed',
        error: 'لم يُرجع الجهاز نتيجة تسجيل للبصمة.',
      };
    }

    localStorage.setItem(
      getCredentialStorageKey(userId),
      bytesToBase64Url(credential.rawId)
    );

    return { success: true };
  } catch (error) {
    return mapCredentialError(error);
  }
}

export async function verifyDeviceBiometric(
  userId: string
): Promise<DeviceBiometricResult> {
  if (!(await isDeviceBiometricAvailable())) {
    return {
      success: false,
      code: 'unsupported',
      error: 'بصمة الجهاز غير مدعومة أو أن الاتصال غير آمن.',
    };
  }

  const credentialId = localStorage.getItem(getCredentialStorageKey(userId));
  if (!credentialId) {
    return {
      success: false,
      code: 'not_registered',
      error: 'لا توجد بصمة مسجلة لهذا الحساب على الجهاز.',
    };
  }

  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        allowCredentials: [
          {
            type: 'public-key',
            id: base64UrlToBytes(credentialId),
          },
        ],
        userVerification: 'required',
        timeout: 60_000,
      },
    });

    if (!credential) {
      return {
        success: false,
        code: 'failed',
        error: 'لم يتم التحقق من بصمة الجهاز.',
      };
    }

    return { success: true };
  } catch (error) {
    return mapCredentialError(error);
  }
}
