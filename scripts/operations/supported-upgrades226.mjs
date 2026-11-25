import assert from 'node:assert/strict';
import {operationalSchema} from './operational-schema.mjs';

const prior = Object.freeze([222, 223, 224, 225]);

export function assertSupportedUpgrade226(version, schema = operationalSchema) {
  assert.equal(schema.ceiling, 226, 'UPGRADE_ADAPTER_NOT_CURRENT');
  assert.equal(schema.upgradeCommand, 'frankfurt-owner-upgrade226', 'UPGRADE_ADAPTER_NOT_CURRENT');
  assert.ok(prior.includes(version) && schema.legacyArchiveCeilings.includes(version), 'UPGRADE_ADAPTER_NOT_CURRENT');
}
