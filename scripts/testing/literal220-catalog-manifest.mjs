// Legacy catalog proof:validate every current file before selecting exact220.
import assert from 'node:assert/strict';
import {assertOperationalManifest} from '../operations/operational-schema.mjs';
/** @param {{name:string,sha256:string}[]} current */
export function reviewed220CatalogManifest(current){
 assertOperationalManifest(current);
 const manifest=current.filter(m=>Number(m.name.slice(0,3))<=220);
 assert.equal(manifest.length,181,'LITERAL220_EXACT_FILE_COUNT');
 assert.equal(manifest.at(-1).name,'220_sales_only_operating_mode.sql','LITERAL220_EXACT_LAST_FILE');
 return manifest;
}
