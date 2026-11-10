import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSalesOnlyAuditTarget,installSalesOnlyAudit,salesOnlyAuditEvidence} from '../scripts/testing/sales-only-phase2-audit-context.mjs';
test('audit keeps original/runtime catalog provenance distinct without duplicating catalog payloads',()=>{
 const evidence=salesOnlyAuditEvidence({originalCatalog:{functions:['original']},runtimeCatalog:{functions:['runtime']},enabled:true,catalogStage:'original219-before-quarantined-overlay'});
 assert.notEqual(evidence.originalCatalogSha256,evidence.runtimeCatalogSha256);
 assert.equal(evidence.enabled,true);assert.equal(evidence.catalogStage,'original219-before-quarantined-overlay');
 assert.equal('originalCatalog'in evidence,false);assert.equal('runtimeCatalog'in evidence,false);
});
test('prototype audit accepts onlyfresh pinnedlocal219 Docker executors;never a URL/existingworkdir/otherproject',()=>{
 const project='nawasrah-service-audit-ab12cd34-test',executor={command:'docker',args:['exec','-i','supabase_db_'+project,'psql']};
 const ok={project,ceiling:219,existingWorkdir:undefined,executor};assert.doesNotThrow(()=>assertSalesOnlyAuditTarget(ok));
 for(const patch of [{ceiling:220},{existingWorkdir:'C:/owner/workdir'},{project:'nawasrah-frankfurt'},{project:'http://127.0.0.1:5432'},{executor:{command:'psql',args:[]}},{executor:{...executor,args:['exec','-i','other']}}])assert.throws(()=>assertSalesOnlyAuditTarget({...ok,...patch}),/QUARANTINED_AUDIT/);
});
test('invalid audit context failsbefore anycatalog read or SQL write',async()=>{
 let reads=0,writes=0;await assert.rejects(installSalesOnlyAudit({project:'hosted',ceiling:219,existingWorkdir:undefined,executor:{command:'docker',args:[]},sql:async()=>{writes++;},json:async()=>{reads++;},inspect:async()=>{reads++;return{};}}),/QUARANTINED_AUDIT/);assert.equal(reads,0);assert.equal(writes,0);
});
