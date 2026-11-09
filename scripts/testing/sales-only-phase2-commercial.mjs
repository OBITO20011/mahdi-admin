import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256} from './sales-only-phase1-bridges.mjs';

const pins=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
// Only the mixed-parcel preview is coupled to WAC. Preserve its entire existing
// commercial body, deleting these exact three cost-only fragments and routing
// the existing feature guard by actor context (POS owner pilot vs public guest).
// This creates
// a NEW private function; it never replaces the pinned public original.
export const costOnlyPreviewFragments=[
 '  v_missing_wac_count INTEGER;\n',
 `          ),
          COUNT(*) FILTER (
            WHERE product.id IS NOT NULL
              AND product.wac_cost_in_minor_units_exact IS NULL
          )
        INTO v_component_total, v_invalid_component_count, v_missing_wac_count`,
 `        IF v_missing_wac_count <> 0 THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE3_EXACT_WAC_UNAVAILABLE: Exact WAC is required for configurable Parcel sale.';
        END IF;
`,
];
export const guestFeatureFragment=`  ) AND public.get_configurable_parcel_feature_state() IS DISTINCT FROM 'ENABLED' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFIGURABLE_PARCEL_DISABLED: Configurable Parcel is unavailable for guest preview.';
  END IF;`;
export const sharedFeatureFragment=`  ) THEN
    IF p_actor_scope='erp_user' THEN
      PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal('erp_user',auth.uid());
    ELSIF p_actor_scope IS DISTINCT FROM 'guest_gateway'
      OR public.get_configurable_parcel_feature_state() IS DISTINCT FROM 'ENABLED' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE='CONFIGURABLE_PARCEL_DISABLED: Configurable Parcel is unavailable for guest preview.';
    END IF;
  END IF;`;
export function untrackedPreviewSource(row){
 assert.equal(row.signature,'preview_guest_promotion_v2(jsonb,text,text)');
 assert.equal(sha256(row.source),pins.functions[row.signature].sourceSha256,'COMMERCIAL_ORIGINAL_SOURCE_DRIFT');
 let source=row.source;
 costOnlyPreviewFragments.forEach((fragment,i)=>{
  assert.equal(source.split(fragment).length,2,'EXACT_COST_FRAGMENT:'+i);
  source=source.replace(fragment,()=>i===1?'          )\n        INTO v_component_total, v_invalid_component_count':'');
 });
 assert.equal(source.split(guestFeatureFragment).length,2,'EXACT_GUEST_FEATURE_CONTEXT');
 source=source.replace(guestFeatureFragment,()=>sharedFeatureFragment);
 return source;
}
export function commercialSql(rows){
 const row=rows.find(r=>r.signature==='preview_guest_promotion_v2(jsonb,text,text)');assert.ok(row);
 const source=untrackedPreviewSource(row);
 return `DO $guard$ BEGIN
 IF current_setting('nawasrah.sales_lite2_test',true) IS DISTINCT FROM 'OWNED_LOCAL_DB219'
 OR(SELECT count(*) FROM supabase_migrations.schema_migrations)<>180
 OR(SELECT max(version::integer) FROM supabase_migrations.schema_migrations)<>219
 THEN RAISE EXCEPTION 'LITE2_QUARANTINED_LOCAL219_ONLY';END IF;
 END $guard$;
 CREATE SCHEMA sales_lite2;
 REVOKE ALL ON SCHEMA sales_lite2 FROM PUBLIC,anon,authenticated,service_role;
 CREATE FUNCTION sales_lite2.preview(p_lines jsonb,p_promotion_code text DEFAULT NULL,p_customer_phone text DEFAULT NULL,p_actor_scope text DEFAULT 'guest_gateway')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions
 AS $lite2_preview$${source}$lite2_preview$;
 REVOKE ALL ON FUNCTION sales_lite2.preview(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
 ${readFileSync(new URL('../../docs/design/sales-only-phase2/commercial-plan.sql',import.meta.url),'utf8')}`;
}
