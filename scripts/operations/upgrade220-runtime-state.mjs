// Preserve post-launch settings,never infer that217's initial held state is current.
import assert from 'node:assert/strict';
import {executeInput} from './build-empty-supabase.mjs';
import {readNotificationSnapshot} from './frankfurt-notification-hold.mjs';
import {sha256} from '../testing/maintenance-db-contract.mjs';
export const upgrade220SettingsSql="BEGIN READ ONLY;SELECT jsonb_build_object('store',(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'')) FROM public.storefront_settings s),'business',(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'')) FROM public.business_alert_settings s),'dispatch',(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'')) FROM public.owner_telegram_dispatch_settings s),'ordersClosed',(SELECT count(*)=1 AND bool_and(NOT orders_enabled) FROM public.storefront_settings),'leaseIdle',(SELECT count(*)=1 AND bool_and(run_id IS NULL AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp())) FROM public.owner_telegram_dispatch_settings));ROLLBACK;";
export const upgrade220ServerBindingSql="BEGIN READ ONLY;SELECT jsonb_build_object('user',current_user,'database',current_database(),'port',current_setting('port')::integer,'host',current_setting('cron.host'));ROLLBACK;";
/** @param {any} observed @param {any} template @param {{requireHeld?:boolean,serverBinding?:{user:string,database:string,port:number,host:string}}} options */
export function assert220Notifications(observed,template,{requireHeld=false,serverBinding}={}){
 assert.ok(observed&&template,'UPGRADE220_NOTIFICATION_INVENTORY_REQUIRED');
 assert.equal(observed.jobs.length,6);assert.equal(template.jobs.length,6);assert.ok(['O','D'].includes(observed.trigger?.enabled));
 assert.deepEqual({...observed.trigger,enabled:template.trigger.enabled},template.trigger,'UPGRADE220_TRIGGER_IDENTITY_CHANGED');
 assert.equal(new Set(observed.jobs.map(j=>j.name)).size,6);assert.equal(new Set(observed.jobs.map(j=>j.id)).size,6);
 if(serverBinding){assert.equal(serverBinding.user,'postgres');assert.equal(serverBinding.database,'postgres');assert.ok(Number.isSafeInteger(serverBinding.port)&&serverBinding.port>0&&serverBinding.port<=65535);assert.ok(typeof serverBinding.host==='string'&&/^[a-zA-Z0-9_./:-]{1,128}$/u.test(serverBinding.host));}
 for(const job of observed.jobs){let expected=template.jobs.find(j=>j.name===job.name);assert.ok(expected,'UPGRADE220_UNKNOWN_CRON');assert.ok(Number.isSafeInteger(job.id)&&job.id>0);assert.equal(typeof job.active,'boolean');
  // Local reference CLI and hosted server have different actual server ports.
  // Bind to read-only server settings,never to an arbitrary caller-supplied port.
  if(serverBinding)expected={...expected,host:serverBinding.host,port:serverBinding.port};
  assert.deepEqual({...job,id:expected.id,active:expected.active},expected,'UPGRADE220_CRON_IDENTITY_CHANGED');if(requireHeld)assert.equal(job.active,false,'UPGRADE220_STOP_CRON_BEFORE_BACKUP');
 }
 return observed;
}
export async function capture220RuntimeState(executor,reference){
 const binding=await executeInput(executor,upgrade220ServerBindingSql);assert.equal(binding.code,0,'UPGRADE220_SERVER_BINDING_READ_FAILED');const serverBinding=JSON.parse(binding.stdout.trim());
 const notifications=assert220Notifications(await readNotificationSnapshot(executor),reference.notificationSnapshot,{requireHeld:true,serverBinding});
 const result=await executeInput(executor,upgrade220SettingsSql);assert.equal(result.code,0,'UPGRADE220_SETTINGS_READ_FAILED');const settings=JSON.parse(result.stdout.trim());
 assert.equal(settings.ordersClosed,true,'UPGRADE220_CLOSE_ORDERS_BEFORE_BACKUP');assert.equal(settings.leaseIdle,true,'UPGRADE220_WAIT_FOR_DISPATCH_LEASE');
 for(const key of ['store','business','dispatch'])assert.match(settings[key],/^[a-f0-9]{32}$/u);
 return {notifications,settings,serverBinding,sha256:sha256(JSON.stringify({notifications,settings,serverBinding}))};
}
export function bind220CatalogTrigger(catalog,state){
 const expected=structuredClone(catalog),rows=expected.triggers.filter(t=>t.schema==='public'&&t.table==='orders'&&t.name==='trg_notify_new_website_order_push');
 assert.equal(rows.length,1);assert.deepEqual({...rows[0],enabled:state.notifications.trigger.enabled},state.notifications.trigger,'UPGRADE220_CATALOG_TRIGGER_IDENTITY_CHANGED');
 rows[0].enabled=state.notifications.trigger.enabled;return expected;
}
