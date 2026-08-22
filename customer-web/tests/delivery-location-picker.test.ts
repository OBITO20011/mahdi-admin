import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const checkout = readFileSync(
  new URL('../src/components/CheckoutModal.tsx', import.meta.url),
  'utf8'
);
const migration = readFileSync(
  new URL(
    '../../supabase/migrations/045_secure_delivery_map_links.sql',
    import.meta.url
  ),
  'utf8'
);
const coordinateMigration = readFileSync(
  new URL(
    '../../supabase/migrations/054_confirm_google_maps_coordinates.sql',
    import.meta.url
  ),
  'utf8'
);

test('checkout distinguishes current location from a different delivery pin', () => {
  assert.match(checkout, /أنا في موقع التوصيل/);
  assert.match(checkout, /موقع التوصيل مختلف/);
  assert.match(checkout, /فتح خرائط Google واختيار المكان/);
  assert.match(checkout, /navigator\.clipboard\?\.readText/);
  assert.match(checkout, /مراجعة موقع التوصيل المختار/);
});

test('database confirms coordinates embedded in trusted direct map links', () => {
  assert.match(
    coordinateMigration,
    /extract_google_maps_coordinates/
  );
  assert.match(coordinateMigration, /NEW\.latitude := v_coordinates\[1\]/);
  assert.match(coordinateMigration, /NEW\.longitude := v_coordinates\[2\]/);
  assert.match(coordinateMigration, /NEW\.location_confirmed := true/);
  assert.match(coordinateMigration, /NEW\.location_source := 'map_pin'/);
});

test('database rejects arbitrary links stored as customer map locations', () => {
  assert.match(migration, /BEFORE INSERT OR UPDATE OF google_maps_url/);
  assert.match(migration, /maps\\\.app\\\.goo\\\.gl/);
  assert.match(migration, /maps\\\.google\\\./);
  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.validate_customer_address_map_url\(\)/
  );
});
