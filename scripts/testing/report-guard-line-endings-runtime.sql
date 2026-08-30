\set ON_ERROR_STOP on

DO $$
DECLARE
  v_expected TEXT := E'  completed_orders AS (\n    SELECT o.*, ce.completed_at\n    FROM completion_events ce\n    JOIN public.orders o ON o.id = ce.order_id\n  ),';
  v_lf TEXT := E'prefix\n  completed_orders AS (\n    SELECT o.*, ce.completed_at\n    FROM completion_events ce\n    JOIN public.orders o ON o.id = ce.order_id\n  ),\nsuffix';
  v_crlf TEXT := REPLACE(v_lf, E'\n', E'\r\n');
  v_sql_change TEXT := REPLACE(v_lf, 'JOIN public.orders o', 'LEFT JOIN public.orders o');
  v_incomplete TEXT := E'prefix\n  completed_orders AS (\n    SELECT o.*, ce.completed_at\n    FROM completion_events ce\nsuffix';
  v_normalized TEXT;
BEGIN
  v_normalized := REPLACE(REPLACE(v_lf, E'\r\n', E'\n'), E'\r', E'\n');
  IF POSITION(v_expected IN v_normalized) = 0 THEN
    RAISE EXCEPTION 'LF report contract must pass after normalization.';
  END IF;

  v_normalized := REPLACE(REPLACE(v_crlf, E'\r\n', E'\n'), E'\r', E'\n');
  IF POSITION(v_expected IN v_normalized) = 0 THEN
    RAISE EXCEPTION 'CRLF report contract must pass after normalization.';
  END IF;

  v_normalized := REPLACE(REPLACE(v_sql_change, E'\r\n', E'\n'), E'\r', E'\n');
  IF POSITION(v_expected IN v_normalized) <> 0 THEN
    RAISE EXCEPTION 'A real SQL contract change must remain blocked.';
  END IF;

  v_normalized := REPLACE(REPLACE(v_incomplete, E'\r\n', E'\n'), E'\r', E'\n');
  IF POSITION(v_expected IN v_normalized) <> 0 THEN
    RAISE EXCEPTION 'An incomplete report contract must remain blocked.';
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'ok', true,
  'guard_scenarios', 4,
  'lf', 'pass',
  'crlf', 'pass',
  'sql_change', 'blocked',
  'incomplete_definition', 'blocked'
);
