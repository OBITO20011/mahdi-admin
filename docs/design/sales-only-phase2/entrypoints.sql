-- Final phase2 installation closes the deliberately limited phase1 prototypes.
-- Owner wrappers retain their ability to delegate privately as postgres.
-- No219 entrypoint or role is changed by this quarantine-only file.
REVOKE ALL ON FUNCTION public.lite1_set_mode(BOOLEAN),public.lite1_pos(JSONB,TEXT),public.lite1_complete(UUID,TEXT),public.lite1_return(UUID,INTEGER,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.lite1_guest(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
