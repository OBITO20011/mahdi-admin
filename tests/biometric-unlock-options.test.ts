import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const biometricLock = readFileSync(
  'src/components/layout/IPhoneContainer.tsx',
  'utf8',
);

test('biometric lock offers password verification and a return to Face ID', () => {
  assert.match(biometricLock, /الدخول بالبريد وكلمة المرور/);
  assert.match(biometricLock, /الرجوع إلى Face ID/);
  assert.match(biometricLock, /handlePasswordUnlock/);
  assert.match(
    biometricLock,
    /reauthenticateForUnlock\([\s\S]*password,[\s\S]*passwordCaptchaToken/u,
  );
  assert.match(biometricLock, /TurnstileWidget/);
  assert.match(biometricLock, /handlePasswordMfaUnlock/);
  assert.match(biometricLock, /verifyUnlockMfa\(passwordMfaCode\)/);
  assert.doesNotMatch(biometricLock, /signOut\(\)/);
});
