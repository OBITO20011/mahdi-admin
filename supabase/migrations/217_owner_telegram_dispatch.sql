-- Owner-approved transport cutover only. Existing outbox payloads, financial
-- producers, ten-attempt retry/dead-letter and Telegram exclusions are unchanged.
-- Closed by default at BOTH database and Edge. No embedded key or recipient.
BEGIN;

CREATE TABLE public.owner_telegram_dispatch_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enabled BOOLEAN NOT NULL DEFAULT false,
  run_id UUID,
  lease_expires_at TIMESTAMPTZ,
  CHECK ((run_id IS NULL) = (lease_expires_at IS NULL))
);
ALTER TABLE public.owner_telegram_dispatch_settings OWNER TO postgres;
ALTER TABLE public.owner_telegram_dispatch_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_telegram_dispatch_settings
  FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.owner_telegram_dispatch_settings(id, enabled) VALUES(true, false);

-- Keep literal096 as the single delivery state machine. Old n8n endpoints
-- retain signatures/WhatsApp behavior; Telegram is fenced server-side even if
-- someone imports/activates an old workflow. No direct service grants on leaves.
ALTER FUNCTION public.claim_automation_deliveries(TEXT, INTEGER, INTEGER)
  RENAME TO owner217_claim_deliveries_internal;
ALTER FUNCTION public.complete_automation_delivery(UUID, TEXT, BOOLEAN, TEXT)
  RENAME TO owner217_complete_delivery_internal;
REVOKE ALL ON FUNCTION public.owner217_claim_deliveries_internal(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.owner217_complete_delivery_internal(UUID, TEXT, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.claim_automation_deliveries(
  p_channel TEXT, p_limit INTEGER DEFAULT 10, p_lease_seconds INTEGER DEFAULT 120
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF lower(trim(coalesce(p_channel,'')))='telegram' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='OWNER_TELEGRAM_EDGE_CONSUMER_REQUIRED';
  END IF;
  RETURN public.owner217_claim_deliveries_internal(p_channel,p_limit,p_lease_seconds);
END;
$$;

CREATE FUNCTION public.complete_automation_delivery(
  p_event_id UUID,p_channel TEXT,p_success BOOLEAN,p_error TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF lower(trim(coalesce(p_channel,'')))='telegram' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='OWNER_TELEGRAM_EDGE_CONSUMER_REQUIRED';
  END IF;
  RETURN public.owner217_complete_delivery_internal(p_event_id,p_channel,p_success,p_error);
END;
$$;

CREATE FUNCTION public.claim_owner_telegram_deliveries_v1(p_run_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_enabled BOOLEAN;
BEGIN
  IF p_run_id IS NULL THEN RAISE EXCEPTION 'OWNER_TELEGRAM_RUN_ID_REQUIRED'; END IF;
  UPDATE public.owner_telegram_dispatch_settings
    SET run_id=p_run_id,lease_expires_at=clock_timestamp()+INTERVAL '90 seconds'
    WHERE id AND enabled AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp());
  IF NOT FOUND THEN
    SELECT enabled INTO v_enabled FROM public.owner_telegram_dispatch_settings WHERE id;
    IF v_enabled IS NULL THEN RAISE EXCEPTION 'OWNER_TELEGRAM_SETTINGS_REQUIRED'; END IF;
    RETURN jsonb_build_object('code',CASE WHEN v_enabled THEN 'OWNER_TELEGRAM_BUSY' ELSE 'OWNER_TELEGRAM_DISABLED' END);
  END IF;
  -- Three messages bound total processing well below the global90s / event120s
  -- leases, with4s Telegram and5s DB HTTP deadlines. No producer/claim math change.
  RETURN public.owner217_claim_deliveries_internal('telegram',3,120);
END;
$$;

CREATE FUNCTION public.owner_telegram_dispatch_lease_valid_v1(p_run_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.owner_telegram_dispatch_settings
    WHERE id AND enabled AND run_id=p_run_id
      AND lease_expires_at>clock_timestamp()+INTERVAL '10 seconds');
$$;

CREATE FUNCTION public.complete_owner_telegram_delivery_v1(
  p_run_id UUID,p_event_id UUID,p_success BOOLEAN,p_error TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.owner_telegram_dispatch_settings
    WHERE id AND enabled AND run_id=p_run_id AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_TELEGRAM_LEASE_LOST'; END IF;
  IF p_success IS NULL OR p_error IS NOT NULL AND p_error NOT IN
    ('OWNER_TELEGRAM_DELIVERY_FAILED','OWNER_BUSINESS_EVENT_NOT_ALLOWED') THEN
    RAISE EXCEPTION 'OWNER_TELEGRAM_COMPLETION_CODE_REQUIRED';
  END IF;
  PERFORM 1 FROM public.automation_event_deliveries
    WHERE event_id=p_event_id AND channel='telegram' AND status='processing'
      AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_TELEGRAM_EVENT_LEASE_LOST'; END IF;
  RETURN public.owner217_complete_delivery_internal(p_event_id,'telegram',p_success,
    CASE WHEN p_success THEN NULL ELSE coalesce(p_error,'OWNER_TELEGRAM_DELIVERY_FAILED') END);
END;
$$;

CREATE FUNCTION public.release_owner_telegram_dispatch_v1(p_run_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE public.owner_telegram_dispatch_settings SET run_id=NULL,lease_expires_at=NULL
    WHERE id AND run_id=p_run_id;
  RETURN jsonb_build_object('success',true);
END;
$$;

CREATE FUNCTION public.enqueue_owner_telegram_dispatch_v1()
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,vault,net,pg_temp AS $$
DECLARE v_url TEXT;v_secret TEXT;v_request BIGINT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.owner_telegram_dispatch_settings WHERE id AND enabled) THEN RETURN NULL; END IF;
  -- Owner enters these through Vault UI. No secret is provisioned by migration.
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name='owner_telegram_dispatch_url')<>1
    OR (SELECT count(*) FROM vault.decrypted_secrets WHERE name='owner_telegram_dispatch_secret')<>1 THEN
    RAISE EXCEPTION 'OWNER_TELEGRAM_VAULT_SETTINGS_REQUIRED';
  END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name='owner_telegram_dispatch_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='owner_telegram_dispatch_secret';
  IF v_url IS DISTINCT FROM 'https://kzevmysfydaslxcerogt.supabase.co/functions/v1/owner-telegram-dispatch'
    OR length(coalesce(v_secret,''))<32 THEN RAISE EXCEPTION 'OWNER_TELEGRAM_VAULT_SETTINGS_INVALID'; END IF;
  SELECT net.http_post(url:=v_url,body:='{"mode":"dispatch"}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','x-owner-telegram-secret',v_secret),
    timeout_milliseconds:=5000) INTO v_request;
  RETURN v_request;
END;
$$;

ALTER FUNCTION public.claim_automation_deliveries(TEXT,INTEGER,INTEGER) OWNER TO postgres;
ALTER FUNCTION public.complete_automation_delivery(UUID,TEXT,BOOLEAN,TEXT) OWNER TO postgres;
ALTER FUNCTION public.claim_owner_telegram_deliveries_v1(UUID) OWNER TO postgres;
ALTER FUNCTION public.owner_telegram_dispatch_lease_valid_v1(UUID) OWNER TO postgres;
ALTER FUNCTION public.complete_owner_telegram_delivery_v1(UUID,UUID,BOOLEAN,TEXT) OWNER TO postgres;
ALTER FUNCTION public.release_owner_telegram_dispatch_v1(UUID) OWNER TO postgres;
ALTER FUNCTION public.enqueue_owner_telegram_dispatch_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_automation_deliveries(TEXT,INTEGER,INTEGER),
  public.complete_automation_delivery(UUID,TEXT,BOOLEAN,TEXT),
  public.claim_owner_telegram_deliveries_v1(UUID),public.owner_telegram_dispatch_lease_valid_v1(UUID),
  public.complete_owner_telegram_delivery_v1(UUID,UUID,BOOLEAN,TEXT),
  public.release_owner_telegram_dispatch_v1(UUID),public.enqueue_owner_telegram_dispatch_v1()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_automation_deliveries(TEXT,INTEGER,INTEGER),
  public.complete_automation_delivery(UUID,TEXT,BOOLEAN,TEXT),
  public.claim_owner_telegram_deliveries_v1(UUID),public.owner_telegram_dispatch_lease_valid_v1(UUID),
  public.complete_owner_telegram_delivery_v1(UUID,UUID,BOOLEAN,TEXT),
  public.release_owner_telegram_dispatch_v1(UUID) TO service_role;

DO $schedule$
DECLARE v_job BIGINT;
BEGIN
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='owner-telegram-dispatch') THEN
    RAISE EXCEPTION 'OWNER_TELEGRAM_CRON_ALREADY_EXISTS';
  END IF;
  v_job:=cron.schedule('owner-telegram-dispatch','* * * * *','SELECT public.enqueue_owner_telegram_dispatch_v1();');
  PERFORM cron.alter_job(v_job,active:=false);
END;
$schedule$;
COMMIT;
