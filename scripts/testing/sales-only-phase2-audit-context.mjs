// Opt-in, fresh owned LOCAL219 audit only. Ordinary owner/diagnostic behavior
// stays unchanged; never installed through a supplied URL or existing workdir.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {phase2PrototypeSql} from './sales-only-phase2-installer.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {assertFrozenFunctions} from './sales-only-phase1-bridges.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';

export function salesOnlyAuditEvidence({originalCatalog,runtimeCatalog,...proof}){
 const digest=catalog=>createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
 return {...proof,originalCatalogSha256:digest(originalCatalog),runtimeCatalogSha256:digest(runtimeCatalog)};
}

export function assertSalesOnlyAuditTarget({project,ceiling,existingWorkdir,executor}){
 assert.equal(ceiling,219,'QUARANTINED_AUDIT_REQUIRES_219');assert.equal(existingWorkdir,undefined,'QUARANTINED_AUDIT_FRESH_ONLY');
 assert.match(project,/^nawasrah-(?:table|service)-audit-[a-f0-9]+-test$/,'QUARANTINED_AUDIT_LOCAL_NAME');
 assert.equal(executor.command,'docker','QUARANTINED_AUDIT_DOCKER_ONLY');
 assert.deepEqual(executor.args.slice(0,3),['exec','-i','supabase_db_'+project],'QUARANTINED_AUDIT_OWNED_EXECUTOR');
}
export async function installSalesOnlyAudit({project,ceiling,existingWorkdir,executor,sql,json,inspect}){
 assertSalesOnlyAuditTarget({project,ceiling,existingWorkdir,executor});
 const owned=await inspect();assert.match(owned.Id,/^[a-f0-9]{64}$/);assert.equal(owned.Config.Labels['com.supabase.cli.project'],project);
 const capturedId=owned.Id;
 assert.deepEqual(await json("SELECT jsonb_build_object('files',count(*),'ceiling',max(version::INTEGER)) FROM supabase_migrations.schema_migrations;"),{files:180,ceiling:219});
 const originalCatalog=await json(schemaCatalogSql),before=await json(functionCatalogSql);
 await sql(phase2PrototypeSql(before));assertFrozenFunctions(before,await json(functionCatalogSql));
 assert.equal((await inspect()).Id,capturedId,'QUARANTINED_AUDIT_CONTAINER_CHANGED');
 return {enabled:true,localOnly:true,activeMigrationCeiling:219,activeMigrationFiles:180,originalBodiesUnchanged:628,exactApprovedBridges:8,
  additionalApprovedShiftStatusGuard:true,catalogStage:'original219-before-quarantined-overlay',originalCatalog,runtimeCatalog:await json(schemaCatalogSql)};
}
