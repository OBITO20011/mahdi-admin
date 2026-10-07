import assert from 'node:assert/strict';

// Exact compatibility signatures intentionally reject new V1 mutations.
// No errors or unrelated warnings may be accepted, regardless of CLI shape.
const parameters = new Map([
  ['public._transfer_inventory_between_warehouses_phase2_legacy', ['p_transfer_date']],
  ['public.create_pos_sale', ['p_warehouse_id', 'p_branch_id', 'p_customer_id',
    'p_customer_name', 'p_payment_method', 'p_items', 'p_discount_in_minor_units',
    'p_amount_received_in_minor_units', 'p_idempotency_key']],
  ['public.return_completed_website_order', ['p_order_id', 'p_reason',
    'p_stock_disposition', 'p_refund_method', 'p_reference_number', 'p_notes']],
]);

export function assertPackageDDbLint(rawOutput) {
  const text = rawOutput.trim();
  assert.ok(text, 'DB lint output must not be empty');
  if (/^No schema errors found\.?$/iu.test(text)) return [];
  const parsed = JSON.parse(text);
  let results;
  if (Array.isArray(parsed)) results = parsed;
  else {
    assert.ok(parsed && typeof parsed === 'object', 'DB lint must be structured');
    if (Object.hasOwn(parsed, 'results')) {
      assert.ok(Object.keys(parsed).every(key => ['results', 'message'].includes(key)),
        'DB lint wrapper has ambiguous or unsupported fields');
      assert.ok(Array.isArray(parsed.results), 'DB lint results must be an array');
      assert.ok(!Object.hasOwn(parsed, 'message') || typeof parsed.message === 'string');
      results = parsed.results;
    } else results = [parsed];
  }
  const accepted = [];
  for (const entry of results) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry)
      && !Object.hasOwn(entry, 'results') && typeof entry.function === 'string');
    assert.ok(Array.isArray(entry.issues) && entry.issues.length > 0);
    const allowed = parameters.get(entry.function);
    assert.ok(allowed, `Unexpected DB lint function: ${entry.function}: ${JSON.stringify(entry.issues)}`);
    for (const issue of entry.issues) {
      assert.ok(issue && typeof issue === 'object' && !Array.isArray(issue));
      assert.match(issue.level || '', /^warning(?: extra)?$/u, 'DB lint errors must fail');
      const parameter = /^unused parameter ["']?(p_[a-z_]+)["']?$/u.exec(issue.message || '')?.[1];
      assert.ok(allowed.includes(parameter), `Unexpected DB warning: ${issue.message}`);
      accepted.push({function: entry.function, ...issue});
    }
  }
  return accepted;
}
