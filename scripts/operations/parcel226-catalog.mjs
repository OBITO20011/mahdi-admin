import assert from 'node:assert/strict';

const names = new Map([
  ['assert_on_parcel_size226_internal', {
    identity: 'assert_on_parcel_size226_internal()', acl: ['postgres=X/postgres'],
  }],
  ['finalize_import_flavor_identity226', {
    identity: 'finalize_import_flavor_identity226(p_flavor_product_id uuid, p_expected_updated_at timestamp with time zone, p_sku text, p_barcode text)',
    acl: ['authenticated=X/postgres', 'postgres=X/postgres'],
  }],
]);
const legacy = new Set(['update_product_master_v4', 'update_product_master_v5']);
const nameOf = row => row.identity.slice(0, row.identity.indexOf('('));
const publicFunctionIn = (row, collection) => row.schema === 'public' && collection.has(nameOf(row));
const isGuard = row => row.schema === 'public' && row.table === 'products'
  && row.name === 'trg_assert_on_parcel_size226';
const ordered = rows => [...rows ?? []].sort();

// The supplied prior catalog must come from the approved 225 reference. This
// verifies a delta against that catalog and never accepts overrides to it.
export function assertParcel226CatalogDelta(before, after) {
  const added = after.functions.filter(row => publicFunctionIn(row, names));
  assert.deepEqual(added.map(nameOf).sort(), [...names.keys()], 'PARCEL226_FUNCTIONS');
  for (const row of added) {
    const expected = names.get(nameOf(row));
    assert.equal(row.identity, expected.identity, 'PARCEL226_FUNCTION_SIGNATURE');
    assert.equal(row.owner, 'postgres', 'PARCEL226_FUNCTION_OWNER');
    assert.equal(row.kind, 'f', 'PARCEL226_FUNCTION_KIND');
    assert.deepEqual(row.configuration, ['search_path=pg_catalog, public'], 'PARCEL226_FUNCTION_PATH');
    assert.deepEqual(ordered(row.acl), expected.acl, 'PARCEL226_FUNCTION_ACL');
    assert.match(row.definition, /\bSECURITY DEFINER\b/u, 'PARCEL226_FUNCTION_DEFINER');
  }

  const priorLegacy = before.functions.filter(row => publicFunctionIn(row, legacy));
  assert.deepEqual(priorLegacy.map(nameOf).sort(), [...legacy], 'PARCEL226_LEGACY_FUNCTIONS');
  const priorByIdentity = new Map(priorLegacy.map(row => [row.identity, row]));
  const functions = after.functions.filter(row => !publicFunctionIn(row, names)).map(row => {
    if (!publicFunctionIn(row, legacy)) return row;
    const prior = priorByIdentity.get(row.identity);
    assert.ok(prior, 'PARCEL226_LEGACY_IDENTITY');
    assert.deepEqual(ordered(prior.acl), ['authenticated=X/postgres', 'postgres=X/postgres'], 'PARCEL226_LEGACY_ACL_BEFORE');
    assert.deepEqual(ordered(row.acl), ['postgres=X/postgres'], 'PARCEL226_LEGACY_ACL_AFTER');
    return {...row, acl: prior.acl};
  });

  const guards = after.triggers.filter(isGuard);
  assert.equal(guards.length, 1, 'PARCEL226_EXACT_TRIGGER');
  assert.equal(guards[0].enabled, 'O', 'PARCEL226_TRIGGER_ENABLED');
  assert.match(guards[0].definition, /DEFERRABLE INITIALLY DEFERRED.*assert_on_parcel_size226_internal\(/u, 'PARCEL226_TRIGGER_DEFINITION');
  assert.deepEqual(after.constraints.filter(isGuard), [{
    name: 'trg_assert_on_parcel_size226', type: 't', local: true, match: ' ', table: 'products',
    schema: 'public', onDelete: ' ', onUpdate: ' ', noInherit: true, validated: true,
    deferrable: true, definition: 'TRIGGER DEFERRABLE INITIALLY DEFERRED', inheritanceCount: 0,
    initiallyDeferred: true,
  }], 'PARCEL226_TRIGGER_CONSTRAINT');
  assert.deepEqual({...after, functions, constraints: after.constraints.filter(row => !isGuard(row)),
    triggers: after.triggers.filter(row => !isGuard(row))},
    before, 'PARCEL226_CHANGED_EXISTING_CATALOG');
}
