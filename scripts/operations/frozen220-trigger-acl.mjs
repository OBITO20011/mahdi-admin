import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';

// Frankfurt ACL212 left these four legacy trigger functions with an explicit
// copy of PostgreSQL's built-in EXECUTE grants. Keep the raw values scoped.
export const frankfurt220TriggerAcl = Object.freeze({
  signatures: Object.freeze([
    'enforce_customer_for_debt_order()',
    'guard_cash_shift_closing_report_snapshot()',
    'set_website_new_order_reservation_expiry()',
    'sync_order_payment_state()',
  ]),
  grants: Object.freeze(['=X/postgres', 'postgres=X/postgres']),
});
export const frankfurt220RawTriggerAcl = '{' + frankfurt220TriggerAcl.grants.join(',') + '}';

/** @typedef {{schema: string, identity: string, owner: string, acl: string[] | null}} FunctionAcl */
/** @param {FunctionAcl} row */
export function hasFrankfurt220TriggerAcl(row) {
  return row.schema === 'public' && row.owner === 'postgres' &&
    frankfurt220TriggerAcl.signatures.includes(row.identity) &&
    isDeepStrictEqual(row.acl, frankfurt220TriggerAcl.grants);
}

/** @param {FunctionAcl[]} functions */
export function frozen220TriggerAclProfile(functions) {
  const rows = frankfurt220TriggerAcl.signatures.map(signature => {
    const matches = functions.filter(row => row.schema === 'public' && row.identity === signature);
    assert.equal(matches.length, 1, 'FROZEN220_TRIGGER_ACL_IDENTITY:' + signature);
    assert.equal(matches[0].owner, 'postgres', 'FROZEN220_TRIGGER_ACL_OWNER:' + signature);
    return matches[0];
  });
  if (rows.every(row => row.acl === null)) return 'local';
  assert.ok(rows.every(hasFrankfurt220TriggerAcl), 'FROZEN220_TRIGGER_ACL_PROFILE_MISMATCH');
  return 'frankfurt';
}

/** @template {FunctionAcl} T @param {T[]} functions */
export function expectFrankfurt220TriggerAcl(functions) {
  assert.equal(frozen220TriggerAclProfile(functions), 'local', 'FROZEN220_LOCAL_REFERENCE_REQUIRED');
  return functions.map(row => row.schema === 'public' && frankfurt220TriggerAcl.signatures.includes(row.identity)
    ? {...row, acl: [...frankfurt220TriggerAcl.grants]}
    : row);
}
