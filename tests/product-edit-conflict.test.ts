import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compareProductEdits,
  readProductEditSnapshot,
  reapplyProductEdits,
  snapshotToEditFields,
  type ProductEditFields,
} from '../src/utils/productEditConflict';
import { toProductMutationFailure } from '../src/services/supabase/products.service';
import { futureMigrationViolations } from '../scripts/testing/maintenance-db-contract.mjs';

const migration = readFileSync('supabase/migrations/170_product_edit_optimistic_concurrency.sql', 'utf8');

const snapshot = {
  productId: '92600000-0000-4000-8000-000000000103',
  updatedAt: '2026-10-15 15:20:14.553555+00',
  nameAr: 'تعديل المالك', sku: 'E-CARTON', barcode: null, description: null,
  categoryId: 'c1', brandId: null, unitName: 'حبة', purchasePackage: 'كرتونة', unitsPerPackage: 24,
  defaultPurchasePriceInMinorUnits: 12000, salePackage: 'كرتونة', unitsPerSalePackage: 24,
  salePackagePriceInMinorUnits: 15500, costPriceInMinorUnits: 500, minStockLevel: 25, maxStockLevel: null,
  isActive: false, flavorNameAr: null, imageUrl: 'https://img/a.png',
};

const opened: ProductEditFields = {
  nameAr: 'صنف', description: '', sku: 'E-CARTON', barcode: '', categoryId: 'c1', brandId: '',
  imageUrl: 'https://img/a.png', purchasePackage: 'كرتونة', unitsPerPackage: 24, defaultPurchasePrice: 12,
  salePackage: 'كرتونة', unitsPerSalePackage: 24, salePackagePrice: 15, reorderPackages: 2, maxPackages: '',
};

test('conflict snapshot parses from the database DETAIL text and rejects junk', () => {
  const parsed = readProductEditSnapshot(JSON.stringify(snapshot));
  assert.ok(parsed);
  assert.equal(parsed.updatedAt, snapshot.updatedAt, 'version is kept as the exact database text');
  assert.equal(parsed.barcode, '');
  assert.equal(parsed.isActive, false);
  assert.equal(readProductEditSnapshot('not json'), null);
  assert.equal(readProductEditSnapshot(JSON.stringify({ nameAr: 'x' })), null);
});

test('snapshot converts to form units: fils to JOD and pieces to sale packages (rounded up like the form)', () => {
  const fields = snapshotToEditFields(readProductEditSnapshot(snapshot)!);
  assert.equal(fields.defaultPurchasePrice, 12);
  assert.equal(fields.salePackagePrice, 15.5);
  assert.equal(fields.reorderPackages, 2, '25 pieces with 24 per package is 2 packages, as toSalePackageCount');
  assert.equal(fields.maxPackages, '');
});

test('compare lists only fields changed by me or by the other user', () => {
  const current = snapshotToEditFields(readProductEditSnapshot(snapshot)!);
  const mine = { ...opened, salePackagePrice: 16, description: 'وصفي' };
  const rows = compareProductEdits(opened, mine, current);
  const byField = Object.fromEntries(rows.map(row => [row.field, row]));
  assert.deepEqual(Object.keys(byField).sort(), ['description', 'nameAr', 'salePackagePrice'].sort());
  assert.equal(byField.nameAr.changedByOther, true);
  assert.equal(byField.nameAr.changedByMe, false);
  assert.equal(byField.salePackagePrice.changedByMe, true);
  assert.equal(byField.salePackagePrice.changedByOther, true, 'both changed the sale price');
});

test('re-apply keeps my changed fields and takes the current value for everything else', () => {
  const current = snapshotToEditFields(readProductEditSnapshot(snapshot)!);
  const mine = { ...opened, salePackagePrice: 16, description: 'وصفي' };
  const merged = reapplyProductEdits(opened, mine, current);
  assert.equal(merged.nameAr, 'تعديل المالك', 'the other user\'s name is kept');
  assert.equal(merged.description, 'وصفي');
  assert.equal(merged.salePackagePrice, 16, 'my explicit price wins only because I changed it');
  assert.equal(merged.reorderPackages, 2);
  assert.deepEqual(reapplyProductEdits(opened, opened, current), current, 'no edits of mine means the current values');
});

test('service maps the database conflict to PRODUCT_EDIT_CONFLICT with the current values', () => {
  const result = toProductMutationFailure({
    code: 'P0001',
    message: 'PRODUCT_EDIT_CONFLICT: عدّل مستخدم آخر هذا المنتج قبل قليل.',
    details: JSON.stringify(snapshot),
    hint: 'اعرض القيم الحالية ثم أعد تطبيق تعديلاتك.',
  }, 'تعذر تحديث المنتج.');
  assert.equal(result.success, false);
  assert.equal(result.errorDetails?.code, 'PRODUCT_EDIT_CONFLICT');
  assert.equal(result.error, 'عدّل مستخدم آخر هذا المنتج قبل قليل.');
  assert.equal(result.conflict?.nameAr, 'تعديل المالك');
  assert.equal(result.conflict?.updatedAt, snapshot.updatedAt);
});

test('product and flavor saves call only the versioned RPCs and send the opened version', () => {
  const service = readFileSync('src/services/supabase/products.service.ts', 'utf8');
  assert.match(service, /rpc\('update_product_master_v4', \{\n\s+p_product_id: input\.productId,\n\s+p_expected_updated_at: input\.expectedUpdatedAt,/u);
  assert.match(service, /rpc\('update_product_flavor_v2', \{\n\s+p_flavor_product_id: input\.flavorProductId,\n\s+p_expected_updated_at: input\.expectedUpdatedAt,/u);
  assert.doesNotMatch(service, /rpc\('update_product_master_v3'|rpc\('update_product_flavor_v1'/u);
  const form = readFileSync('src/features/products/ProductFormModal.tsx', 'utf8');
  assert.match(form, /updateProduct\(initialProduct\.id, payload, \{\n\s+expectedUpdatedAt: openedVersion,/u,
    'the form sends the version it opened, not the store copy');
});

test('migration 170 is explicit, definer-safe, closes the unversioned paths and changes no pricing body', () => {
  assert.deepEqual(futureMigrationViolations(migration), []);
  for (const name of ['update_product_master_v4', 'update_product_flavor_v2', 'product_edit_assert_version_internal', 'product_edit_snapshot_internal']) {
    const body = migration.slice(migration.indexOf(`CREATE FUNCTION public.${name}(`));
    assert.ok(body.length < migration.length, `${name} is created explicitly`);
    assert.match(body.slice(0, 1500), /SECURITY DEFINER\nSET search_path = public, pg_temp/u, `${name} definer + fixed search_path`);
  }
  assert.match(migration, /FOR UPDATE;/u, 'the version check locks the row');
  assert.match(migration, /IS DISTINCT FROM p_expected_updated_at/u);
  assert.match(migration, /PRODUCT_EDIT_CONFLICT: عدّل مستخدم آخر هذا المنتج قبل قليل\./u);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.update_product_master_v3\([\s\S]*?\) FROM PUBLIC, anon, authenticated;/u);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.update_product_flavor_v1\([\s\S]*?FROM PUBLIC, anon, authenticated;/u);
  for (const internal of ['product_edit_snapshot_internal(UUID)', 'product_edit_assert_version_internal(UUID, TIMESTAMPTZ)'])
    assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${internal} FROM authenticated;`), `${internal} is internal only`);
  assert.doesNotMatch(migration, /CREATE (?:OR REPLACE )?FUNCTION public\.(?:update_product_master_v[23]|update_product_flavor_v1)\(/u,
    'existing pricing/stock bodies are not redefined');
  assert.doesNotMatch(migration, /\bUPDATE public\.products\b|inventory_|wac_cost/u, 'the wrapper writes nothing itself');
});

test('the approved parity mapping reverts exactly this change and rejects anything else', async () => {
  const { approvedProductEditConflictSource } = await import('./strict-product-legacy-source');
  const file = 'src/stores/useAppStore.ts';
  const source = readFileSync(file, 'utf8');
  const reverted = approvedProductEditConflictSource(file, source);
  assert.doesNotMatch(reverted, /expectedUpdatedAt/u, 'the store goes back to the pre-170 source');
  assert.throws(() => approvedProductEditConflictSource(file, source.replace('expectedUpdatedAt: options.expectedUpdatedAt ?? current.updatedAt',
    'expectedUpdatedAt: current.updatedAt')), /UNAPPROVED_PRODUCT_EDIT_CHANGE/u);
});
