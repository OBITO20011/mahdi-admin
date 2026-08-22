-- Remove the temporary Web Push diagnostic entry point after the real iPhone
-- delivery flow was verified. Production dispatches now accept new orders only.

BEGIN;

DROP FUNCTION IF EXISTS public.send_test_push_notification();

ALTER TABLE public.push_dispatches
  DROP CONSTRAINT IF EXISTS push_dispatches_event_type_check;

ALTER TABLE public.push_dispatches
  ADD CONSTRAINT push_dispatches_event_type_check
  CHECK (event_type = 'new_order');

COMMIT;
