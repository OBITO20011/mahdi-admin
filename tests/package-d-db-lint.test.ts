import assert from 'node:assert/strict';
import test from 'node:test';
import {assertPackageDDbLint} from '../scripts/testing/package-d-db-lint-policy.mjs';

const finding = (fn = 'public.create_pos_sale', message = 'unused parameter "p_items"', level = 'warning extra') => ({
  function: fn, issues: [{level, message}],
});
test('Package D lint supports CLI array, single finding and exclusive results wrapper', () => {
  const row = finding();
  for (const payload of [row, [row], {results: [row]}, {results: [row], message: 'db lint'}]) {
    assert.deepEqual(assertPackageDDbLint(JSON.stringify(payload)), [{function: row.function, ...row.issues[0]}]);
  }
  for (const text of ['[]', '{"results":[]}', 'No schema errors found.']) {
    assert.deepEqual(assertPackageDDbLint(text), []);
  }
});
test('Package D lint allows only exact unused compatibility parameters', () => {
  for (const row of [finding('public._transfer_inventory_between_warehouses_phase2_legacy', 'unused parameter "p_transfer_date"'),
    finding('public.return_completed_website_order', 'unused parameter "p_refund_method"')]) {
    assert.equal(assertPackageDDbLint(JSON.stringify([row])).length, 1);
  }
  for (const row of [finding(undefined, undefined, 'error'), finding(undefined, 'never read variable "v_shift_id"'),
    finding(undefined, 'unused parameter "p_unexpected"'), finding('public.unapproved', 'unused parameter "p_items"')]) {
    for (const payload of [row, [finding(), row], {results: [finding(), row]}]) {
      assert.throws(() => assertPackageDDbLint(JSON.stringify(payload)));
    }
  }
});
test('Package D lint cannot hide root findings behind results or accept malformed output', () => {
  for (const payload of [{results: [], ...finding()}, {results: [], errors: [finding()]},
    {results: [], message: finding()}, {results: null}, [null], [[]], {function: 'public.create_pos_sale', issues: []},
    {...finding(), issues: [null]}, null, true, 42]) {
    assert.throws(() => assertPackageDDbLint(JSON.stringify(payload)));
  }
  for (const text of ['', 'garbage', '{}']) assert.throws(() => assertPackageDDbLint(text));
});
