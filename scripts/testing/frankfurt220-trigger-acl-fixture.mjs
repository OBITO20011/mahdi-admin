// Test fixture only. Callers run this on their owned local Docker executor.
import {frankfurt220TriggerAcl} from '../operations/frozen220-trigger-acl.mjs';

export const frankfurt220TriggerAclFixtureSql=frankfurt220TriggerAcl.signatures
  .map(signature=>'GRANT EXECUTE ON FUNCTION public.'+signature+' TO PUBLIC;').join('\n');

export const frankfurt220TriggerAclReadSql=`SELECT jsonb_agg(jsonb_build_object(
  'schema','public','identity',p.proname||'()','owner',p.proowner::regrole::text,'acl',p.proacl
) ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN (
  ${frankfurt220TriggerAcl.signatures.map(signature=>"'public."+signature+"'::regprocedure").join(',')}
);`;
