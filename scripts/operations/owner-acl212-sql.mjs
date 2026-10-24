// Builds a reviewable owner artifact; does not execute SQL.
import assert from 'node:assert/strict';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';

export function buildOwnerAcl212Sql(manifest,commands){
 const json=JSON.stringify(manifest,null,2);
 assert.ok(!json.includes('$manifest212$'));
 const catalog=schemaCatalogSql.replace('BEGIN READ ONLY;','').replace(');ROLLBACK;',') INTO v_catalog;');
 assert.ok(catalog.includes('INTO v_catalog;'));
 return `-- OWNER ONLY / postgres / Frankfurt. Prepared from saved files; NOT executed.
-- Full public212 scope: ${manifest.functionNames.length} names / ${manifest.objects.filter(o=>o.section==='functions').length} functions / ${manifest.tableNames.length} relations.
-- Validate ALL objects, metadata and complete174 history BEFORE first REVOKE.
-- Exact known extras only; RESTRICT; no GRANT, business writes or default-privilege changes.
-- Reference SHA256: ${manifest.referenceSha256}
-- Observed SHA256: ${manifest.observedSha256}
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_temp;
CREATE TEMP TABLE owner_acl212_result (
 object_kind text,object_identity text,owner_name text,configuration jsonb,
 acl jsonb,removed_privileges integer,matches_reference boolean
) ON COMMIT DROP;
DO $owner_acl212$
DECLARE
 v_manifest constant jsonb := $manifest212$${json}$manifest212$::jsonb;
 v_catalog jsonb;v_object jsonb;v_actual jsonb;v_shape jsonb;v_acl jsonb;
 v_related jsonb;v_history jsonb;v_before jsonb:='{}'::jsonb;
 v_count integer;v_pass integer;v_section text;
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'OWNER_ACL212_POSTGRES_REQUIRED'; END IF;
 IF current_setting('server_version_num')::integer/10000 <> 17 THEN RAISE EXCEPTION 'OWNER_ACL212_POSTGRES17_REQUIRED'; END IF;
 IF NOT pg_try_advisory_xact_lock(734151139) THEN RAISE EXCEPTION 'OWNER_ACL212_UPGRADE_RUNNING'; END IF;
 FOR v_pass IN 1..2 LOOP
  SELECT coalesce(jsonb_agg(version::text ORDER BY version::text COLLATE "C"),'[]'::jsonb)
   INTO v_history FROM supabase_migrations.schema_migrations;
  IF v_history IS DISTINCT FROM v_manifest->'history' THEN RAISE EXCEPTION 'OWNER_ACL212_HISTORY_MISMATCH'; END IF;
  ${catalog}
  SELECT count(*) INTO v_count FROM jsonb_array_elements(v_catalog->'functions') r WHERE r->>'schema'='public';
  IF v_count <> ${manifest.objects.filter(o=>o.section==='functions').length} THEN RAISE EXCEPTION 'OWNER_ACL212_FUNCTION_SCOPE_MISMATCH'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(v_catalog->'tables') r WHERE r->>'schema'='public';
  IF v_count <> ${manifest.tableNames.length} THEN RAISE EXCEPTION 'OWNER_ACL212_RELATION_SCOPE_MISMATCH'; END IF;
  FOREACH v_section IN ARRAY ARRAY['constraints','indexes','policies','triggers','sequences','defaultPrivileges','schemas'] LOOP
   -- Preserve exact bigint metadata; JSON/JavaScript numeric rounding is not
   -- an acceptable equivalence for a sequence boundary.
   SELECT coalesce(jsonb_agg(CASE WHEN v_section='sequences' THEN
    r||jsonb_build_object('start',r->>'start','increment',r->>'increment',
      'max',r->>'max','min',r->>'min','cache',r->>'cache') ELSE r END ORDER BY n),'[]'::jsonb) INTO v_related
    FROM jsonb_array_elements(v_catalog->v_section) WITH ORDINALITY AS e(r,n)
    WHERE CASE WHEN v_section='schemas' THEN r->>'name'='public' ELSE r->>'schema'='public' END;
   IF v_related IS DISTINCT FROM v_manifest->'related'->v_section THEN
    RAISE EXCEPTION 'OWNER_ACL212_RELATED_METADATA_MISMATCH: %',v_section;
   END IF;
  END LOOP;
  FOR v_object IN SELECT value FROM jsonb_array_elements(v_manifest->'objects') LOOP
   SELECT count(*),jsonb_agg(r)->0 INTO v_count,v_actual
    FROM jsonb_array_elements(v_catalog->(v_object->>'section')) r
    WHERE r->>'schema'='public' AND coalesce(r->>'identity',r->>'name')=v_object->>'identity';
   IF v_count<>1 THEN RAISE EXCEPTION 'OWNER_ACL212_IDENTITY_MISMATCH: %',v_object->>'key'; END IF;
   v_shape:=v_actual-'acl';
   IF v_object->>'section'='functions' THEN
    v_shape:=(v_shape-'definition')||jsonb_build_object('definitionMd5',md5(regexp_replace(v_actual->>'definition',E'\\r+\\n',E'\\n','g')));
   END IF;
   IF v_shape IS DISTINCT FROM v_object->'shape' THEN
    RAISE EXCEPTION 'OWNER_ACL212_OWNER_CONFIG_OR_STRUCTURE_MISMATCH: %',v_object->>'key';
   END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object('grantee',e.grantee_name,'grantor',e.grantor_name,
    'privilege',e.privilege_type,'grantable',e.is_grantable)
    ORDER BY e.grantee_name COLLATE "C",e.grantor_name COLLATE "C",e.privilege_type COLLATE "C"),'[]'::jsonb)
    INTO v_acl FROM (
     SELECT CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee_name,
      pg_get_userbyid(x.grantor) AS grantor_name,x.privilege_type,x.is_grantable
     FROM aclexplode(ARRAY(SELECT jsonb_array_elements_text(
      CASE WHEN v_actual->'acl'='null'::jsonb THEN v_object->'defaultAcl' ELSE v_actual->'acl' END))::aclitem[]) x
    ) e;
   IF NOT (v_acl @> (v_object->'expectedAcl') AND ((v_object->'expectedAcl')||(v_object->'allowedExtra')) @> v_acl)
    OR (v_pass=2 AND v_acl IS DISTINCT FROM v_object->'expectedAcl') THEN
    RAISE EXCEPTION 'OWNER_ACL212_UNEXPECTED_ACL: %',v_object->>'key';
   END IF;
   IF v_pass=1 THEN
    v_before:=v_before||jsonb_build_object(v_object->>'key',jsonb_array_length(v_acl)-jsonb_array_length(v_object->'expectedAcl'));
   ELSE
    INSERT INTO pg_temp.owner_acl212_result VALUES(v_object->>'section',v_object->>'signature',
     v_actual->>'owner',v_actual->'configuration',v_acl,(v_before->>(v_object->>'key'))::integer,true);
   END IF;
  END LOOP;
  IF v_pass=1 THEN
   -- FIRST REVOKE: complete precondition has passed for every scoped object.
${commands.map(c=>'   '+c).join('\n')}
  END IF;
 END LOOP;
END;
$owner_acl212$;
-- Expect ${manifest.objects.length} rows, every matches_reference=true.
-- removed_privileges is this execution's actual reduction (zero on a repeat).
SELECT object_kind,object_identity,owner_name,configuration,acl,removed_privileges,matches_reference
 FROM pg_temp.owner_acl212_result ORDER BY object_kind,object_identity COLLATE "C";
COMMIT;
`;
}
