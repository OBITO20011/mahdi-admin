import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PassThrough} from 'node:stream';
import {singleSkuPhysicalQuantity} from '../src/features/orders/aftercarePresentation';

const read = (path: string) => readFileSync(path, 'utf8');
test('runtime fingerprint transport preserves Arabic UTF8 across split stdout chunks',async()=>{
  for(const file of ['scripts/testing/run-package-d-database-runtime.mjs','scripts/testing/run-phase3-basic-current-runtime.mjs']) {
    assert.match(read(file),/child.stdout.setEncoding\('utf8'\)/u);
  }
  const stream=new PassThrough();stream.setEncoding('utf8');let text='';
  stream.on('data',chunk=>{text+=chunk;});
  const ended=new Promise<void>(resolve=>stream.on('end',resolve));
  const expected=JSON.stringify({notes:'بيع POS رقم',cost:100,quantity:5});const bytes=Buffer.from(expected,'utf8');
  for(const byte of bytes)stream.write(Buffer.from([byte]));
  stream.end();await ended;assert.equal(text,expected);assert.deepEqual(JSON.parse(text),JSON.parse(expected));
});
test('carton damage captures immutable sale-time standalone price and rejects old missing evidence only for damage',()=>{
  const sql=read('supabase/migrations/132_package_d_system_unification.sql');
  assert.match(sql,/ADD COLUMN effective_standalone_unit_sale_price_snapshot_in_minor_units BIGINT/u);
  assert.match(sql,/BEFORE INSERT OR UPDATE ON public.order_items/u);
  assert.match(sql,/PACKAGE_D_CARTON_PRICE_IMMUTABLE/u);
  assert.match(sql,/v_rejected::BIGINT\*COALESCE\(v_order_item.effective_standalone_unit_sale_price_snapshot_in_minor_units,0\)/u);
  assert.match(sql,/v_applied_damage := LEAST\(v_item_refund,v_raw_damage\)/u);
  assert.match(sql,/v_rejected>0 AND v_order_item.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL/u);
  assert.match(sql,/package_d_assert_carton_return_item_internal\(to_jsonb\(v_item\)\)/u);
  assert.doesNotMatch(sql,/UPDATE public.order_items[\s\S]{0,100}SET effective_standalone_unit_sale_price_snapshot/u);
});
test('Package D modern coordinators use one explicit NULL-safe sale guard', () => {
  const sql=read('supabase/migrations/132_package_d_system_unification.sql');
  assert.match(sql,/v_creation_type IS NULL OR v_creation_type NOT IN/u);
  assert.match(sql,/PHASE42_SALE_CONTRACT_UNSUPPORTED/u);
  assert.match(sql,/PHASE43_SALE_CONTRACT_UNSUPPORTED/u);
  assert.doesNotMatch(sql,/pg_get_functiondef|\bEXECUTE\s+(?:format\s*\(|')|\bREPLACE\s*\(/iu);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.package_d_settle_sales_return_before_guard_internal/u);
});

test('zero packet price is absent evidence, not a failed carton sale or a guessed damage price',()=>{
  const sql=read('supabase/migrations/132_package_d_system_unification.sql');
  const capture=sql.slice(sql.indexOf('CREATE FUNCTION public.package_d_capture_single_sku_price_snapshot()'),
    sql.indexOf('CREATE TRIGGER trg_package_d_capture_single_sku_price_snapshot'));
  assert.ok(capture.indexOf('v_packet_price=0 THEN RETURN NEW')<capture.indexOf('phase4_effective_standalone_unit_price_internal'));
  assert.match(capture,/FOR SHARE/u);assert.doesNotMatch(capture,/EXCEPTION WHEN|:=\s*0/u);
  assert.match(sql,/v_damage>0 AND v_sale.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL/u);
  const preview=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.preview_guest_promotion_v2('),sql.indexOf('CREATE TABLE public.pos_uncommitted'));
  assert.ok(preview.indexOf('PARCEL_COMPONENT_INVALID')<preview.indexOf('phase3_canonicalize_sale_request_internal'));
});
test('Package D does not activate feature state', () => {
  const sql=read('supabase/migrations/132_package_d_system_unification.sql');
  assert.doesNotMatch(sql,/UPDATE public\.configurable_parcel_feature_settings/iu);
  assert.match(sql,/PACKAGE_D_POS_V2_REQUIRED/u);
  assert.match(sql,/PACKAGE_D_MODERN_AFTERCARE_REQUIRED/u);
  assert.match(sql,/v_used \+ NEW\.consumed_quantity > v_capacity/u);
});

test('single SKU aftercare accepts only whole cartons using the immutable conversion', () => {
  assert.equal(singleSkuPhysicalQuantity(3,5),15);
  assert.equal(singleSkuPhysicalQuantity(1,1),1);
  for(const [cartons,factor] of [[1.5,5],[0,5],[-1,5],[1,0],[1,1.5],[2147483647,2],[NaN,5]]) {
    assert.throws(()=>singleSkuPhysicalQuantity(cartons,factor));
  }
});

test('unknown POS cancellation is a server locked active contract, not browser deletion', () => {
  const sql=read('supabase/migrations/132_package_d_system_unification.sql');
  const recovery=read('src/services/supabase/posV2Recovery.ts');
  assert.match(sql,/CREATE FUNCTION public\.get_pos_sale_attempt_state_v1/u);
  assert.match(sql,/CREATE FUNCTION public\.cancel_uncommitted_pos_sale_attempt_v1/u);
  assert.match(sql,/pg_advisory_xact_lock\(hashtext\(v_key\)\)/u);
  assert.match(sql,/PACKAGE_D_POS_ATTEMPT_CANCELLED/u);
  assert.match(sql,/PHASE3_POS_PAYMENT_METHOD_INVALID/u);
  assert.doesNotMatch(recovery,/localStorage\.removeItem|localStorage\.clear/u);
  assert.match(recovery,/cancel_uncommitted_pos_sale_attempt_v1/u);
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.phase4_finalize_aftercare_operation_foundation_internal/u);
  assert.match(sql,/commercial_line_kind IN \('base_unit','legacy_single_sku_parcel'\)/u);
  assert.match(sql,/ALTER FUNCTION public\.get_pos_sale_attempt_state_v1\(TEXT,TEXT\) OWNER TO postgres/iu);
});

test('CI preserves the historical gate and separately runs current132 contract families and before-mode',()=>{
  const workflow=read('.github/workflows/quality.yml');
  assert.match(workflow,/NAWASRAH_MAX_MIGRATION: '131'\s+run: npm run test:db:runtime/u);
  assert.match(workflow,/NAWASRAH_PACKAGE_D_MODE: before/u);
  assert.match(workflow,/suite: \[package-d, before-after, phase3, phase3-basic, phase42, phase43, phase44-financial, phase44-lineage, phase44-concurrency, pos-browser\]/u);
  assert.match(workflow,/run: node scripts\/testing\/run-phase3-basic-current-runtime\.mjs/u);
  for(const family of ['phase3-contracts','phase42-return','phase43-aftercare','phase44-financial','phase44-lineage','phase44-concurrency']) {
    assert.ok(workflow.includes(`run: npm run test:${family}:runtime`));
  }
  assert.match(workflow,/current-database-runtime:[\s\S]*?timeout-minutes: 35/u);
  assert.doesNotMatch(workflow,/continue-on-error:\s*true/u);
});
