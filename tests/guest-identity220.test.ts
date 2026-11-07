import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {guestIdentityDefinitions220} from '../scripts/testing/build-guest-identity220.mjs';
import {GuestDeliveryProposal} from '../src/features/orders/GuestDeliveryProposal';

test('220 guest identity patch leaves current order money/stock/idempotency and authenticated legacy behavior literal',async()=>{
 const definitions=await guestIdentityDefinitions220(process.cwd());assert.equal(definitions.length,3);
 const v2=definitions[0];
 const reverse=v2.candidate.replace('    -- Guest delivery details belong to this order,not the existing CRM card.',`    UPDATE public.customers SET full_name = BTRIM(p_customer_full_name),
      phone = v_phone, governorate = BTRIM(p_governorate), updated_at = NOW()
    WHERE id = v_customer_id;`).replace('  -- Existing default addresses remain unchanged,including when none exists.',`  UPDATE public.customer_addresses SET is_default = false
  WHERE customer_id = v_customer_id AND is_default;`).replace('    p_latitude IS NOT NULL, NOT v_customer_reused\n  );','    p_latitude IS NOT NULL, true\n  );');
 assert.equal(reverse,v2.original);
 const guest="auth.role() IS NOT DISTINCT FROM 'service_role' AND COALESCE(NULLIF(TRIM(p_source), ''), 'website') = 'website'";
 const base=definitions[1],start=base.original.indexOf('    UPDATE public.customers\n'),end=base.original.indexOf(';',start)+1,update=base.original.slice(start,end);
 const defaults=`  UPDATE public.customer_addresses
  SET is_default = false
  WHERE customer_id = v_customer_id
    AND is_default = true;`;
 const baseReverse=base.candidate.replace(`    IF NOT (${guest}) THEN\n${update}\n    END IF;`,update)
  .replace(`  IF NOT (v_customer_reused AND ${guest}) THEN\n${defaults}\n  END IF;`,defaults)
  .replace(`    NOT (v_customer_reused AND ${guest})\n  )`,'    true\n  )');
 assert.equal(baseReverse,base.original,'V1 stock,price,validation,snapshot and authenticated branch bytes exact');
 const wrapper=definitions[2],wholesale=`  UPDATE public.customers
  SET customer_type = 'wholesale', updated_at = NOW()
  WHERE id = v_customer_id;`;
 assert.equal(wrapper.candidate.replace(`  IF NOT (COALESCE((v_legacy_result->>'customer_reused')::BOOLEAN, false) AND ${guest}) THEN\n${wholesale}\n  END IF;`,wholesale),wrapper.original);
 for(const definition of definitions){assert.doesNotMatch(definition.candidate,/\b(?:GRANT|REVOKE|ALTER ROLE)\b/u);assert.match(definition.candidate,/SECURITY DEFINER/u);assert.match(definition.candidate,/search_path (?:TO 'public', 'pg_temp'|= public, pg_temp)/u);}
 for(const d of definitions.slice(1))assert.match(d.candidate,/auth\.role\(\) IS NOT DISTINCT FROM 'service_role'/u);
 assert.match(definitions[1].candidate,/NOT \(v_customer_reused AND auth\.role/u);
 assert.match(definitions[2].candidate,/v_legacy_result->>'customer_reused'/u);
 const source=readFileSync('src/services/supabase/orders.service.ts','utf8');assert.match(source,/guestRecipientName: ord\.source === 'website' \? ord\.customer_name_snapshot/u);
});

test('guest delivery proposal labels order input and existing card separately,with manual review only and escaped text',()=>{
 const html=renderToStaticMarkup(createElement(GuestDeliveryProposal,{recipientName:'مستلم <img>',customerName:'اسم البطاقة',address:'عنوان الطلب',onReview:()=>assert.fail('render must never approve/write')}));
 for(const text of ['اسم المستلم:','الاسم في بطاقة الزبون:','تغيير مقترح','لا يُعتمد تلقائياً','مراجعة بطاقة الزبون لاعتماد التغيير يدوياً'])assert.ok(html.includes(text));
 assert.ok(html.includes('&lt;img&gt;'));assert.ok(!html.includes('<img>'));
 const file=readFileSync('src/features/orders/GuestDeliveryProposal.tsx','utf8');assert.doesNotMatch(file,/\b(?:supabase|fetch|useEffect|rpc)\b/u);
});
