-- OWNER ONLY,after217 strict verification/RESET/data/manual test and launch
-- approval. First Edge ENABLED=true / TEST_ENABLED=false. No secret literals.
BEGIN;
DO $enable$
DECLARE j record;
BEGIN
 IF (SELECT count(*) FROM public.owner_telegram_dispatch_settings)<>1
   OR NOT EXISTS(SELECT 1 FROM public.owner_telegram_dispatch_settings WHERE id AND NOT enabled
      AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()))
 THEN RAISE EXCEPTION 'OWNER217_ACTIVATION_SETTINGS_PRECONDITION';END IF;
 IF (SELECT count(*) FROM cron.job WHERE jobname='owner-telegram-dispatch')<>1
 THEN RAISE EXCEPTION 'OWNER217_ACTIVATION_JOB_COUNT';END IF;
 SELECT * INTO j FROM cron.job WHERE jobname='owner-telegram-dispatch';
 IF j.active OR j.schedule<>'* * * * *'
   OR j.command<>'SELECT public.enqueue_owner_telegram_dispatch_v1();'
 THEN RAISE EXCEPTION 'OWNER217_ACTIVATION_JOB_PRECONDITION';END IF;
 IF EXISTS(SELECT 1 FROM public.automation_event_deliveries
    WHERE channel='telegram' AND status='processing' AND lease_expires_at>clock_timestamp())
 THEN RAISE EXCEPTION 'OWNER217_WAIT_FOR_PREVIOUS_DELIVERY_LEASES';END IF;
 IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name='owner_telegram_dispatch_url')<>1
   OR (SELECT count(*) FROM vault.decrypted_secrets WHERE name='owner_telegram_dispatch_secret')<>1
   OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='owner_telegram_dispatch_url'
     AND decrypted_secret='https://kzevmysfydaslxcerogt.supabase.co/functions/v1/owner-telegram-dispatch')
   OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='owner_telegram_dispatch_secret' AND length(decrypted_secret)>=32)
 THEN RAISE EXCEPTION 'OWNER217_ACTIVATION_VAULT_PRECONDITION';END IF;
 UPDATE public.owner_telegram_dispatch_settings SET enabled=true,run_id=NULL,lease_expires_at=NULL WHERE id;
 PERFORM cron.alter_job(j.jobid,active:=true);
END $enable$;
SELECT s.enabled AS database_enabled,j.active AS cron_active,j.schedule
 FROM public.owner_telegram_dispatch_settings s CROSS JOIN cron.job j
 WHERE s.id AND j.jobname='owner-telegram-dispatch';
COMMIT;
