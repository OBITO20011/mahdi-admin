// Closed owner-approved adapter admission; archive support alone is insufficient.
import assert from 'node:assert/strict';
import {operationalSchema} from './operational-schema.mjs';

export const supportedPriorUpgrades224=Object.freeze([222,223]);
export function assertSupportedUpgrade224(version,schema=operationalSchema){
 assert.ok(supportedPriorUpgrades224.includes(version),'UPGRADE_ADAPTER_NOT_CURRENT');
 const own=schema.ceiling===version&&schema.upgradeCommand===`frankfurt-owner-upgrade${version}`;
 const previous222=version===222&&schema.ceiling===223&&schema.upgradeCommand==='frankfurt-owner-upgrade223'&&schema.legacyArchiveCeilings.includes(222);
 const under224=schema.ceiling===224&&schema.upgradeCommand==='frankfurt-owner-upgrade224'&&schema.legacyArchiveCeilings.includes(version);
 assert.ok(own||previous222||under224,'UPGRADE_ADAPTER_NOT_CURRENT');
}
