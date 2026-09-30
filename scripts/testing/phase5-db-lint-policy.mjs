import assert from 'node:assert/strict';

// Only the documented historical compatibility warning is acceptable.
export function assertPhase5DbLint(rawOutput) {
  const text = rawOutput.trim();
  if (/^No schema errors found\.?$/iu.test(text)) return [];
  assert.ok(text, 'DB lint output must not be empty');
  const parsed = JSON.parse(text);
  let results;
  if (Array.isArray(parsed)) {
    results = parsed;
  } else {
    assert.ok(parsed && typeof parsed === 'object', 'DB lint output must be structured');
    if (Object.hasOwn(parsed, 'results')) {
      // A wrapper and a finding are mutually exclusive. Never discard root
      // findings (or unknown sibling fields) while selecting wrapped results.
      assert.ok(Object.keys(parsed).every((key) => ['results', 'message'].includes(key)),
        'DB lint wrapper contains ambiguous or unsupported fields');
      assert.ok(Array.isArray(parsed.results), 'DB lint wrapper results must be an array');
      assert.ok(!Object.hasOwn(parsed, 'message') || typeof parsed.message === 'string',
        'DB lint wrapper message must be text');
      results = parsed.results;
    } else {
      results = [parsed];
    }
  }
  const accepted = [];
  for (const result of results) {
    assert.ok(result && typeof result === 'object' && !Array.isArray(result)
      && !Object.hasOwn(result, 'results') && typeof result.function === 'string');
    assert.ok(Array.isArray(result.issues) && result.issues.length > 0,
      'DB lint finding must contain structured issues');
    for (const issue of result.issues) {
      assert.match(issue.level || '', /^warning(?: extra)?$/u);
      assert.match(result.function,
        /^(?:public\.)?(?:transfer_inventory_between_warehouses|_transfer_inventory_between_warehouses_phase2_legacy)(?:\([^)]*\))?$/u);
      assert.match(issue.message || '', /^unused parameter ["']?p_transfer_date["']?$/u);
      accepted.push({ function: result.function, ...issue });
    }
  }
  return accepted;
}
