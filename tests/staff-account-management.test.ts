import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const initialMigration = readFileSync(
  'supabase/migrations/064_secure_staff_account_management.sql',
  'utf8',
);
const ownerMigration = readFileSync('supabase/migrations/065_multiple_system_owners.sql', 'utf8');
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
const navigationConfig = readFileSync(
  'src/features/more/adminNavigation.config.ts',
  'utf8',
);

test('staff account records are owner-only audited RPCs', () => {
  for (const functionName of [
    'get_erp_staff_accounts',
    'create_erp_staff_account_record',
    'update_erp_staff_account_record',
    'set_erp_staff_account_active',
    'record_erp_staff_password_reset',
    'get_erp_staff_account_audit_logs',
  ]) {
    assert.match(initialMigration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}`));
  }
  assert.match(initialMigration, /ARRAY\['owner'\]/);
  assert.match(initialMigration, /entity_name,\s*\n\s*entity_id,\s*\n\s*details/);
  assert.match(initialMigration, /REVOKE ALL ON FUNCTION public\.create_erp_staff_account_record[\s\S]*FROM PUBLIC, anon/);
  assert.match(initialMigration, /GRANT EXECUTE ON FUNCTION public\.get_erp_staff_accounts\(\) TO authenticated/);
  assert.match(initialMigration, /role\.code = 'owner'/);
  assert.match(initialMigration, /p_user_id = auth\.uid\(\)/);
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

test('only an owner can assign a second owner while the final active owner remains protected', () => {
  assert.match(moreMenu, /roleName === 'owner'/);
  assert.match(navigationConfig, /المستخدمون والصلاحيات/);
  assert.match(userForm, /مالك النظام/);
  assert.match(userForm, /إنشاء مالك نظام إضافي/);
  assert.match(ownerMigration, /لا يمكن خفض صلاحية آخر مالك نظام نشط/);
  assert.match(ownerMigration, /لا يمكن تعطيل آخر مالك نظام نشط/);
  assert.match(ownerMigration, /pg_advisory_xact_lock/);
  assert.match(ownerMigration, /ARRAY\['owner'\]/);
  assert.match(functionSource, /'owner'/);
  assert.match(usersView, /هذه الشاشة للمالك فقط/);
});
