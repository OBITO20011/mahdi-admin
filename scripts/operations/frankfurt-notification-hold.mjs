// Owner2026-10-15: reversible environment step AFTER literal001-138,not a migration.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {executeInput} from './build-empty-supabase.mjs';
import {assessBuildCron} from './build-cron-report.mjs';
import {catalogDifference} from '../testing/schema-catalog.mjs';

export const heldTrigger='trg_notify_new_website_order_push';
export const heldJobNames=Object.freeze(['expire-stale-new-website-orders','scan-core-business-alerts','scan-business-summaries','run-advanced-monitoring']);
const snapshotSelect=`SELECT jsonb_build_object(
 'trigger',(SELECT jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,
 'definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='orders' AND t.tgname='${heldTrigger}' AND NOT t.tgisinternal),
 'jobs',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',jobid,'name',jobname,'schedule',schedule,
 'command',command,'host',nodename,'port',nodeport,'database',database,'username',username,'active',active)
 ORDER BY jobname),'[]'::jsonb) FROM cron.job))`;
export const notificationSnapshotSql='BEGIN READ ONLY;'+snapshotSelect+';ROLLBACK;';
export function validateOriginalNotifications(snapshot){
 assert.equal(snapshot.trigger?.schema,'public','HOLD_TRIGGER_SCHEMA');
 assert.equal(snapshot.trigger.table,'orders','HOLD_TRIGGER_TABLE');
 assert.equal(snapshot.trigger.name,heldTrigger,'HOLD_TRIGGER_NAME');
 assert.equal(snapshot.trigger.enabled,'O','HOLD_TRIGGER_MUST_START_ENABLED');
 assert.equal(snapshot.trigger.definition,'CREATE TRIGGER '+heldTrigger+' AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION notify_new_website_order_push()','HOLD_TRIGGER_DEFINITION');
 assessBuildCron(snapshot.jobs);
 assert.ok(snapshot.jobs.every(j=>j.active===true),'HOLD_JOBS_MUST_START_ACTIVE');
 assert.equal(new Set(snapshot.jobs.map(j=>j.id)).size,5,'HOLD_UNIQUE_JOB_IDS');
 for(const j of snapshot.jobs)assert.ok(Number.isSafeInteger(j.id)&&j.id>0,'HOLD_JOB_ID');
 return snapshot;
}
export function expectedHeldNotifications(original){
 validateOriginalNotifications(original);
 const held=structuredClone(original);held.trigger.enabled='D';
 for(const job of held.jobs)if(heldJobNames.includes(job.name))job.active=false;
 return held;
}
const sqlJson=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
export function notificationTransitionSql(original,restore=false){
 const held=expectedHeldNotifications(original),before=restore?held:original,after=restore?original:held;
 // SERIALIZABLE fails closed on conflicting writes. Use only pg_cron's
 // supported API;postgres has SELECT on cron.job,not table-lock privileges.
 // The orders lock is the ordinary lock needed for ALTER TABLE's trigger.
 return `\\set VERBOSITY verbose
 BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL search_path=public,pg_temp;
 LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;
 DO $notification_hold$ BEGIN
 IF (${snapshotSelect}) IS DISTINCT FROM ${sqlJson(before)} THEN
 RAISE EXCEPTION 'NOTIFICATION_HOLD_SNAPSHOT_CHANGED'; END IF;
 ALTER TABLE public.orders ${restore?'ENABLE':'DISABLE'} TRIGGER ${heldTrigger};
 ${original.jobs.filter(j=>heldJobNames.includes(j.name)).map(j=>`PERFORM cron.alter_job(${j.id}::bigint,active := ${restore?'true':'false'});`).join('\n')}
 IF (${snapshotSelect}) IS DISTINCT FROM ${sqlJson(after)} THEN
 RAISE EXCEPTION 'NOTIFICATION_HOLD_POSTCONDITION'; END IF;
 END $notification_hold$;COMMIT;`;
}
export async function readNotificationSnapshot(executor){
 const read=await executeInput(executor,notificationSnapshotSql);
 assert.equal(read.code,0,'NOTIFICATION_SNAPSHOT_FAILED');return JSON.parse(read.stdout.trim());
}
export async function transitionNotifications(executor,original,restore=false){
 const result=await executeInput(executor,notificationTransitionSql(original,restore));
 const state=result.stderr.match(/ERROR:\s+([0-9A-Z]{5}):/u)?.[1]??'UNAVAILABLE';
 assert.equal(result.code,0,(restore?'NOTIFICATION_RESTORE_FAILED':'NOTIFICATION_HOLD_FAILED')+'_SQLSTATE_'+state);
 const actual=await readNotificationSnapshot(executor);
 assert.deepEqual(actual,restore?original:expectedHeldNotifications(original),'NOTIFICATION_STATE_MISMATCH');
 return actual;
}
export function isExpectedHeldTriggerDifference(d){
 return d.section==='triggers'&&d.before?.schema==='public'&&d.before?.table==='orders'
  &&d.before?.name===heldTrigger&&d.before?.enabled==='O'&&d.after?.enabled==='D'
  &&isDeepStrictEqual({...d.before,enabled:'D'},d.after);
}
// Exactly ONE allowed catalog delta: enabled O->D on the named trigger.
// Cron schedules/commands remain byte-identical;four active bits are proved by
// the separate exact full-row snapshot,not excluded from any catalog section.
/** @param {{beforeBuildDate:string,afterBuildDate:string}} [buildDates] */
export function assertHeldCatalog(original,held,buildDates=undefined){
 const differences=catalogDifference(original,held,buildDates);
 assert.equal(differences.length,1,'HOLD_CATALOG_EXPECTS_EXACTLY_ONE_DELTA');
 const d=differences[0];assert.equal(d.section,'triggers','HOLD_UNEXPECTED_CATALOG_SECTION');
 assert.equal(d.before?.schema,'public');assert.equal(d.before?.table,'orders');assert.equal(d.before?.name,heldTrigger);
 assert.equal(d.before.enabled,'O');assert.equal(d.after?.enabled,'D');
 assert.ok(isDeepStrictEqual({...d.before,enabled:'D'},d.after),'HOLD_UNEXPECTED_TRIGGER_CHANGE');
 return {expectedDifferenceCount:1,section:'triggers',schema:'public',table:'orders',name:heldTrigger,before:'O',after:'D'};
}
