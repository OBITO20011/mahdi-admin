// The219 dependency guard intentionally evaluates its own219 operational contract.
// All214-219 Backup/Restore checks before/after remain on current220 code.
// Only the historical219 rehearsal lifecycle runs in an exact hash-bound clone;
// no owner tool or SQL001-219 byte is rewritten and no guard is weakened.
import path from'node:path';import{pathToFileURL}from'node:url';import{readFile}from'node:fs/promises';
import{proveRehearsal219Lifecycle as original}from'./rehearsal219-lifecycle.mjs';import{prepareWorkbookRuntimeView,cleanupWorkbookRuntimeView}from'./product-workbook-runtime-view.mjs';
export async function proveRehearsal219Lifecycle(options){const root=path.resolve(import.meta.dirname,'../..'),state=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));if(state.migrationCeiling!==220)return original(options);const view=await prepareWorkbookRuntimeView({schemaOnly:true});try{const legacy=await import(pathToFileURL(path.join(view.root,'scripts/testing/rehearsal219-lifecycle.mjs')).href);return{...await legacy.proveRehearsal219Lifecycle(options),contractFixture:{sourceHead:view.head,ceiling:219,onlyExact220Removed:true,originalOwnerToolsUnchanged:true,currentBackupRestoreBeforeAfterUnchanged:true}};}finally{await cleanupWorkbookRuntimeView(view.root);}}
