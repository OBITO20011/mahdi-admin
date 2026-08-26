import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/074_secure_warehouse_rpcs_and_self_profile.sql',
  'utf8',
);
const inventoryService = readFileSync(
  'src/services/supabase/inventory.service.ts',
  'utf8',
);
const appStore = readFileSync('src/stores/useAppStore.ts', 'utf8');
const transferModal = readFileSync(
  'src/features/inventory/WarehouseTransferModal.tsx',
  'utf8',
);
const authService = readFileSync(
  'src/services/supabase/auth.service.ts',
  'utf8',
);
const authStore = readFileSync('src/stores/useAuthStore.ts', 'utf8');
const profileModal = readFileSync(
  'src/features/more/ProfileModal.tsx',
  'utf8',
);

test('legacy warehouse RPC drift is fail-closed and the active transfer is guarded', () => {
  for (const functionName of [
    'create_supplier_return',
    'create_stock_count_session',
    'approve_stock_count',
  ]) {
    assert.match(
      migration,
      new RegExp(`to_regprocedure\\('public\\.${functionName}`),
      `${functionName} must be checked before its permissions are changed`,
    );
  }

  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.transfer_inventory_between_warehouses\(/,
  );
  assert.match(migration, /PERFORM public\.assert_erp_role\(/);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.transfer_inventory_between_warehouses/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /reserved_quantity/);
  assert.match(migration, /'transfer_out'/);
  assert.match(migration, /'transfer_in'/);
});

test('inventory transfer is a real Supabase RPC and never a local-only movement', () => {
  assert.match(
    inventoryService,
    /export async function transferInventoryBetweenWarehousesInSupabase/,
  );
  assert.match(
    inventoryService,
    /rpc\(\s*'transfer_inventory_between_warehouses'/,
  );

  const transferStart = appStore.indexOf('public async transferWarehouse');
  const transferEnd = appStore.indexOf('public async executeStockCount', transferStart);
  const transferBody = appStore.slice(transferStart, transferEnd);

  assert.ok(transferStart >= 0 && transferEnd > transferStart);
  assert.match(transferBody, /await transferInventoryBetweenWarehousesInSupabase/);
  assert.match(transferBody, /refreshInventoryMovementsFromSupabase/);
  assert.doesNotMatch(transferBody, /this\.state\.movements\.unshift/);
  assert.doesNotMatch(transferBody, /prod\.warehouseId\s*=/);

  assert.match(transferModal, /await transferWarehouse\(/);
  assert.match(transferModal, /if \(result\?\.success\)\s*\{\s*onClose\(\)/);
  assert.doesNotMatch(transferModal, /transferQty > selectedProduct\.onHandQuantity/);
});

test('self profile and password updates use protected Supabase sources', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_my_erp_profile/);
  assert.match(migration, /DROP POLICY IF EXISTS "Allow users to update own profile"/);
  assert.match(migration, /REVOKE UPDATE ON TABLE public\.profiles FROM authenticated/);
  assert.match(authService, /rpc\(\s*'update_my_erp_profile'/);
  assert.match(authService, /auth\.updateUser\(/);
  assert.match(authStore, /public async refreshCurrentUser/);
  assert.match(authStore, /jobTitle: result\.profile\?\.job_title/);
  assert.match(profileModal, /await updateMyProfileInSupabase/);
  assert.match(profileModal, /await updateMyPasswordInSupabase/);
  assert.match(profileModal, /await refreshCurrentUser\(\)/);
  assert.doesNotMatch(profileModal, /changePassword\(/);
  assert.doesNotMatch(profileModal, /updateProfile\(/);
});
