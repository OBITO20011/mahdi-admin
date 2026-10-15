import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {businessCronJobs,cronInventorySql,assessBuildCron} from '../scripts/operations/build-cron-report.mjs';
const rows=businessCronJobs.map(j=>({name:j.name,command:'SELECT '+j.calls+';',schedule:'fixture',active:true}));
test('five literal migration cron commands are inventoried without running or disabling them',()=>{
 const audit=assessBuildCron(rows);assert.equal(audit.jobs.length,5);
 assert.equal(audit.implementedDisable,false);assert.equal(audit.externalRequestExecuted,false);
 assert.match(cronInventorySql,/BEGIN READ ONLY/u);assert.doesNotMatch(cronInventorySql,/alter_job|unschedule|EXECUTE/u);
 assert.deepEqual(audit.proposedTemporaryDisabledJobs,['expire-stale-new-website-orders','scan-core-business-alerts','scan-business-summaries','run-advanced-monitoring']);
 assert.equal(audit.orderInsertRisk.endpointProject,'acjtabdqqnpwhdvbvnyw');
 assert.equal(audit.requiresOwnerReview,false);assert.equal(audit.ownerApprovedTemporaryHold,true);
 assert.throws(()=>assessBuildCron(rows.slice(1)));
 assert.throws(()=>assessBuildCron(rows.map((r,i)=>i===0?{...r,command:'SELECT net.http_post();'}:r)));
});
test('historical push has a real old-project HTTP target and auto-created secret;outbox delivery is a separate gateway',async()=>{
 const push=await readFile('supabase/migrations/033_order_web_push_notifications.sql','utf8');
 assert.match(push,/vault.create_secret/u);assert.match(push,/net.http_post/u);
 assert.ok(push.includes('https://acjtabdqqnpwhdvbvnyw.supabase.co/functions/v1/send-order-push'));
 assert.match(push,/AFTER INSERT ON public.orders/u);
 const outbox=await readFile('supabase/migrations/099_advanced_monitoring_and_business_integrity.sql','utf8');
 assert.match(outbox,/INSERT INTO public.automation_events/u);assert.doesNotMatch(outbox,/net.http_post/u);
 const expiry=await readFile('supabase/migrations/097_core_business_alerts.sql','utf8');
 assert.match(expiry,/CREATE TRIGGER trg_enqueue_expired_order_business_alert\s+AFTER UPDATE OF status ON public.orders/u);
 assert.match(expiry,/EXECUTE FUNCTION public.enqueue_expired_order_business_alert\(\)/u);
 const ownerScript=await readFile('scripts/operations/frankfurt-owner-build.mjs','utf8');
 assert.ok(ownerScript.indexOf('reference.cronAudit?.requiresOwnerReview')<ownerScript.indexOf('const password=await ownerPassword()'));
});
