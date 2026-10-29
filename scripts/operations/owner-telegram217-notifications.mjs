//217 adds exactly one HELD cron row. The original five rows/trigger keep the
// old strict transition. Only the new allocated jobid may differ by environment.
import assert from 'node:assert/strict';
import {executeInput} from './build-empty-supabase.mjs';
import {expectedHeldNotifications,notificationSnapshotSql,readNotificationSnapshot,heldJobNames,heldTrigger} from './frankfurt-notification-hold.mjs';
import {assessBuildCron} from './build-cron-report.mjs';
export const ownerTelegramJob=Object.freeze({name:'owner-telegram-dispatch',schedule:'* * * * *',command:'SELECT public.enqueue_owner_telegram_dispatch_v1();'});
export async function assertOwner217HeldSettings(executor){
 const r=await executeInput(executor,"BEGIN READ ONLY;SELECT count(*)=1 AND bool_and(id AND NOT enabled AND run_id IS NULL AND lease_expires_at IS NULL) FROM public.owner_telegram_dispatch_settings;ROLLBACK;");
 assert.equal(r.code,0,'OWNER217_SETTINGS_READ_FAILED');assert.equal(r.stdout.trim(),'t','OWNER217_SETTINGS_MUST_REMAIN_HELD');return true;
}
export function assessOwner217Cron(rows){
 const extra=rows.filter(r=>r.name===ownerTelegramJob.name);assert.equal(extra.length,1,'OWNER217_CRON_INVENTORY_REQUIRED');
 assert.deepEqual(extra[0],{...ownerTelegramJob,active:false},'OWNER217_NEW_CRON_MUST_REMAIN_HELD');
 const old=assessBuildCron(rows.filter(r=>r.name!==ownerTelegramJob.name),{migrationCeiling:217});
 return {...old,jobs:[...old.jobs,{...extra[0],migration:'217',effect:'http',directHttp:true,externalDeliveryRequiresConsumer:false}],ownerTelegramHeld:true,currentTransport:'Original five DB/outbox jobs unchanged; owner Telegram pg_net job installed inactive and DB/Edge gates false'};
}
export function expectedHeld217Notifications(original,observed){
 const previous={...original,jobs:original.jobs.filter(j=>j.name!==ownerTelegramJob.name)};
 const base=expectedHeldNotifications(previous),rows=observed.jobs.filter(j=>j.name===ownerTelegramJob.name);
 assert.equal(rows.length,1,'OWNER217_EXACT_ONE_HELD_JOB_REQUIRED');
 const row=rows[0],template=previous.jobs[0];assert.ok(Number.isSafeInteger(row.id)&&row.id>0,'OWNER217_JOB_ID_REQUIRED');
 assert.ok(!base.jobs.some(j=>j.id===row.id),'OWNER217_JOB_ID_COLLISION');
 const expected={id:row.id,...ownerTelegramJob,host:template.host,port:template.port,database:template.database,username:template.username,active:false};
 assert.deepEqual(row,expected,'OWNER217_CRON_MUST_REMAIN_EXACT_AND_HELD');
 // Validation above is exact; retain PostgreSQL jsonb key order for the
 // existing nested catalog serializer without masking any field difference.
 return {...base,jobs:[...base.jobs,structuredClone(row)].sort((a,b)=>a.name.localeCompare(b.name,'en'))};
}
export async function hold217Notifications(executor,original){
 const expected=expectedHeld217Notifications(original,original);
 const select=notificationSnapshotSql.replace(/^BEGIN READ ONLY;/u,'').replace(/;ROLLBACK;$/u,'');
 const json=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
 const commands=original.jobs.filter(j=>heldJobNames.includes(j.name)).map(j=>`PERFORM cron.alter_job(${j.id}::bigint,active:=false);`).join('\n');
 const result=await executeInput(executor,`BEGIN ISOLATION LEVEL SERIALIZABLE;LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;
 DO $hold$ BEGIN IF (${select}) IS DISTINCT FROM ${json(original)} THEN RAISE EXCEPTION 'OWNER217_HOLD_PRECONDITION';END IF;
 ALTER TABLE public.orders DISABLE TRIGGER ${heldTrigger};${commands}
 IF (${select}) IS DISTINCT FROM ${json(expected)} THEN RAISE EXCEPTION 'OWNER217_HOLD_POSTCONDITION';END IF;END $hold$;COMMIT;`);
 assert.equal(result.code,0,'OWNER217_HOLD_TRANSITION_FAILED');assert.deepEqual(await readNotificationSnapshot(executor),expected);return expected;
}
