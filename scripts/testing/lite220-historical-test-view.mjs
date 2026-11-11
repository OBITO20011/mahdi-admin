// Explicit legacy-test view only. Current runtime/probes/owner tools never use it.
// Query ASTs,source hashes,roles and rows are returned untouched;only exact
// checked phase3 metadata rewinds to bfc219 for the existing historical oracle.
import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{inventory}from'../audit/table-access-inventory.mjs';import{sourceBeforeSalesOnlyPhase3}from'../audit/source-before-sales-only-phase3.mjs';
/** @param {string} file @param {string} raw @returns {string} */
export function historical220Text(file,raw){return sourceBeforeSalesOnlyPhase3(file,raw)??raw;}
export function historical220InventoryMetadata(source,rawState){const current=JSON.parse(rawState);assert.equal(source.migrationCeiling,current.migrationCeiling,'HISTORICAL220_ACTUAL_CEILING_DRIFT');const before=JSON.parse(historical220Text('docs/agent/project-state.json',rawState));return{...source,migrationCeiling:before.migrationCeiling};}
export async function historical220Inventory(options){const source=await inventory(options),state=await readFile(new URL('../../docs/agent/project-state.json',import.meta.url),'utf8');return historical220InventoryMetadata(source,state);}
