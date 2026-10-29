-- OWNER ONLY. Also set Edge OWNER_TELEGRAM_ENABLED=false. Do not reactivate n8n.
BEGIN;
DO $disable$
DECLARE j record;
BEGIN
 IF (SELECT count(*) FROM public.owner_telegram_dispatch_settings)<>1
   OR (SELECT count(*) FROM cron.job WHERE jobname='owner-telegram-dispatch')<>1
 THEN RAISE EXCEPTION 'OWNER217_STOP_SINGLETON_REQUIRED';END IF;
 SELECT * INTO j FROM cron.job WHERE jobname='owner-telegram-dispatch';
 IF j.schedule<>'* * * * *' OR j.command<>'SELECT public.enqueue_owner_telegram_dispatch_v1();'
 THEN RAISE EXCEPTION 'OWNER217_STOP_JOB_CHANGED';END IF;
 UPDATE public.owner_telegram_dispatch_settings SET enabled=false WHERE id;
 PERFORM cron.alter_job(j.jobid,active:=false);
END $disable$;
SELECT s.enabled AS database_enabled,j.active AS cron_active
 FROM public.owner_telegram_dispatch_settings s CROSS JOIN cron.job j
 WHERE s.id AND j.jobname='owner-telegram-dispatch';
COMMIT;
