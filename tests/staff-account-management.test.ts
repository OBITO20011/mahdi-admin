import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/064_secure_staff_account_management.sql',
  'utf8',
);
const functionSource = readFileSync(
  'supabase/functions/manage-staff-users/index.ts',
  'utf8',
);
const config = readFileSync('supabase/config.toml', 'utf8');
const staffService = readFileSync(
  'src/services/supabase/staffAccounts.service.ts',
  'utf8',
);
const usersView = readFileSync('src/features/users/UsersView.tsx', 'utf8');
const userForm = readFileSync('src/features/users/UserFormModal.tsx', 'utf8');
const moreMenu = readFileSync('src/features/more/MoreMenuView.tsx', 'utf8');

test('staff account records are owner-only audited RPCs', () => {
  for (const functionName of [
    'get_erp_staff_accounts',
    'create_erp_staff_account_record',
    'update_erp_staff_account_record',
    'set_erp_staff_account_active',
    'record_erp_staff_password_reset',
    'get_erp_staff_account_audit_logs',
  ]) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}`));
  }
  assert.match(migration, /ARRAY\['owner'\]/);
  assert.match(migration, /entity_name,\s*\n\s*entity_id,\s*\n\s*details/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_erp_staff_account_record[\s\S]*FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_erp_staff_accounts\(\) TO authenticated/);
  assert.match(migration, /role\.code = 'owner'/);
  assert.match(migration, /p_user_id = auth\.uid\(\)/);
});

test('the browser reaches staff management only through the protected Edge Function', () => {
  assert.match(staffService, /functions\.invoke\('manage-staff-users'/);
  assert.doesNotMatch(staffService, /auth\.admin/);
  assert.match(usersView, /fetchStaffAccounts\(\)/);
  assert.doesNotMatch(usersView, /createUser\(|updateUser\(|disableUser\(|resetUserPassword\(/);
  assert.doesNotMatch(userForm, /useAppStore/);
  assert.match(userForm, /كلمة المرور المؤقتة/);
});

test('Edge Function authenticates caller, limits origin, and keeps service role server-side', () => {
  assert.match(functionSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(functionSource, /caller\.auth\.getUser\(token\)/);
  assert.match(functionSource, /isApprovedOrigin/);
  assert.match(functionSource, /auth\.admin\.createUser/);
  assert.match(functionSource, /auth\.admin\.deleteUser/);
  assert.match(functionSource, /ban_duration: desiredBanDuration/);
  assert.match(functionSource, /record_erp_staff_password_reset/);
  assert.match(functionSource, /validRoleCodes/);
  assert.doesNotMatch(functionSource, /console\.log\([^\n]*(password|body\.password)/i);
  assert.match(config, /\[functions\.manage-staff-users\]\s*\nverify_jwt = true/);
});

test('only the owner sees the staff management entry point and owner role cannot be assigned', () => {
  assert.match(moreMenu, /roleName === 'owner'/);
  assert.match(moreMenu, /المستخدمون والصلاحيات/);
  assert.match(userForm, /صلاحية المالك لا تُنشأ أو تُمنح/);
  assert.match(usersView, /هذه الشاشة للمالك فقط/);
});
