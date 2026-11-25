// Closed sequence for the owner-approved220→222→223→224→225 cutover.
// Archive compatibility alone never admits an upgrade adapter.
import assert from 'node:assert/strict';
import {operationalSchema} from './operational-schema.mjs';
import {assertSupportedUpgrade226} from './supported-upgrades226.mjs';

export const supportedPriorUpgrades225=Object.freeze([222,223,224]);
export function assertSupportedUpgrade225(version,schema=operationalSchema){
 assert.ok(supportedPriorUpgrades225.includes(version),'UPGRADE_ADAPTER_NOT_CURRENT');
 if(schema.ceiling===226)return assertSupportedUpgrade226(version,schema);
 assert.equal(schema.ceiling,225,'UPGRADE_ADAPTER_NOT_CURRENT');
 assert.equal(schema.upgradeCommand,'frankfurt-owner-upgrade225','UPGRADE_ADAPTER_NOT_CURRENT');
 assert.ok(schema.legacyArchiveCeilings.includes(version),'UPGRADE_ADAPTER_NOT_CURRENT');
}
