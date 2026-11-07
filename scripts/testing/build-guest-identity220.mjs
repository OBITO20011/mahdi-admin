// Quarantined220 only. Reproduce the current writers from immutable migrations,
// changing customer identity/default-address effects,never order money or stock.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {extractSqlFunction} from './build-home219-read-sql.mjs';

const once=(source,before,after)=>{assert.equal(source.split(before).length,2,'GUEST220_EXPECTED_EXACT_SINGLE_PATCH');return source.replace(before,after);};
export async function guestIdentityDefinitions220(root){
 const migration=async name=>(await readFile(path.join(root,'supabase/migrations',name),'utf8')).replaceAll('\r\n','\n');
 const v2=extractSqlFunction(await migration('209_product_sale_methods.sql'),'submit_guest_customer_order_v2');
 const base=extractSqlFunction(await migration('018_customer_order_linking.sql'),'create_customer_order').replace('FUNCTION public.create_customer_order(','FUNCTION public.create_customer_order_base_units_legacy(');
 const wrapper=extractSqlFunction(await migration('023_wholesale_order_accounting.sql'),'create_customer_order').replace('FUNCTION public.create_customer_order(','FUNCTION public.package_d_create_customer_order_before_source_guard_internal(');
 let v2Next=once(v2,`    UPDATE public.customers SET full_name = BTRIM(p_customer_full_name),
      phone = v_phone, governorate = BTRIM(p_governorate), updated_at = NOW()
    WHERE id = v_customer_id;`,`    -- Guest delivery details belong to this order,not the existing CRM card.`);
 v2Next=once(v2Next,`  UPDATE public.customer_addresses SET is_default = false
  WHERE customer_id = v_customer_id AND is_default;`,`  -- Existing default addresses remain unchanged,including when none exists.`);
 v2Next=once(v2Next,'    p_latitude IS NOT NULL, true\n  );','    p_latitude IS NOT NULL, NOT v_customer_reused\n  );');
 // The service-only V1 compatibility gateway still reaches these private
 // writers. Preserve authenticated manual order entry byte-for-byte in ELSE.
 const guest=`auth.role() IS NOT DISTINCT FROM 'service_role' AND COALESCE(NULLIF(TRIM(p_source), ''), 'website') = 'website'`;
 const updateStart=base.indexOf('    UPDATE public.customers\n'),updateEnd=base.indexOf(';',updateStart)+1;assert.ok(updateStart>0&&updateEnd>updateStart);
 const update=base.slice(updateStart,updateEnd);
 let baseNext=once(base,update,`    IF NOT (${guest}) THEN\n${update}\n    END IF;`);
 const defaults=`  UPDATE public.customer_addresses
  SET is_default = false
  WHERE customer_id = v_customer_id
    AND is_default = true;`;
 baseNext=once(baseNext,defaults,`  IF NOT (v_customer_reused AND ${guest}) THEN\n${defaults}\n  END IF;`);
 baseNext=once(baseNext,`    p_latitude IS NOT NULL AND p_longitude IS NOT NULL,
    true
  )`,`    p_latitude IS NOT NULL AND p_longitude IS NOT NULL,
    NOT (v_customer_reused AND ${guest})
  )`);
 const wholesale=`  UPDATE public.customers
  SET customer_type = 'wholesale', updated_at = NOW()
  WHERE id = v_customer_id;`;
 const wrapperNext=once(wrapper,wholesale,`  IF NOT (COALESCE((v_legacy_result->>'customer_reused')::BOOLEAN, false) AND ${guest}) THEN\n${wholesale}\n  END IF;`);
 return [
  {name:'submit_guest_customer_order_v2',original:v2,candidate:v2Next},
  {name:'create_customer_order_base_units_legacy',original:base,candidate:baseNext},
  {name:'package_d_create_customer_order_before_source_guard_internal',original:wrapper,candidate:wrapperNext},
 ];
}
export async function buildGuestIdentity220(root){return '-- GUEST220_IDENTITY_ONLY: owner approved7Nov;no financial or privilege change.\n'+(await guestIdentityDefinitions220(root)).map(x=>x.candidate).join('\n\n')+'\n';}
