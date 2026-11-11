import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256} from './sales-only-phase1-bridges.mjs';
const pins=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
export const drawerSignature='get_cash_shift_movement_page(uuid,text,text,integer,integer)';
export const drawerHunks=[
 ["      COALESCE((SELECT MIN(h.created_at) FROM public.order_status_history h\n        WHERE h.order_id=o.id AND h.new_status='completed'),o.updated_at) at,",
  "      COALESCE((SELECT completed_at FROM sales_lite1.completions WHERE order_id=o.id),(SELECT MIN(h.created_at) FROM public.order_status_history h\n        WHERE h.order_id=o.id AND h.new_status='completed'),o.updated_at) at,"],
 ["    SELECT 'owner_withdrawal',w.id,w.withdrawal_number,w.created_at,'cash',w.amount_in_minor_units,'سحب مالك'",
  "    SELECT 'lite_return',r.id,o.order_number,r.created_at,r.method,r.money_refund,'ردّ مبلغ لفاتورة بلا مخزون'\n    FROM sales_lite1.returns r JOIN public.orders o ON o.id=r.order_id\n    WHERE p_kind='refunds' AND r.shift_id=p_shift_id AND r.method=p_method AND r.money_refund>0\n    UNION ALL\n    SELECT 'owner_withdrawal',w.id,w.withdrawal_number,w.created_at,'cash',w.amount_in_minor_units,'سحب مالك'"],
 ['public.trial212_cash_metadata_internal(source,id)','sales_lite2.drawer_metadata(source,id)'],
];
export function drawerSource(row){
 assert.equal(row.signature,drawerSignature);assert.equal(sha256(row.source),pins.functions[drawerSignature].sourceSha256,'DRAWER_FROZEN_SOURCE_DRIFT');
 let body=row.source;for(const [from,to]of drawerHunks){assert.equal(body.split(from).length,2,'DRAWER_EXACT_HUNK:'+from.slice(0,60));body=body.replace(from,()=>to);}return body;
}
export function drawerSql(before){
 const row=before.find(r=>r.signature===drawerSignature);assert.ok(row);
 const helpers=readFileSync(new URL('../../docs/design/sales-only-phase2/drawer-readers.sql',import.meta.url),'utf8');
 const body=drawerSource(row);
 return helpers+`\nCREATE FUNCTION sales_lite2.drawer_page(p_shift_id UUID,p_kind TEXT,p_method TEXT,p_page INTEGER,p_page_size INTEGER) RETURNS JSONB
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $drawer_body$${body}$drawer_body$;
 REVOKE ALL ON FUNCTION sales_lite2.drawer_page(UUID,TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
 CREATE FUNCTION public.lite1_shift_movements2(p_shift_id UUID,p_kind TEXT,p_method TEXT DEFAULT 'cash',p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25) RETURNS JSONB
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
 IF (p_kind='sales' AND EXISTS(SELECT 1 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id WHERE o.cash_shift_id=p_shift_id))
 OR(p_kind='refunds' AND EXISTS(SELECT 1 FROM sales_lite1.returns r WHERE r.shift_id=p_shift_id AND r.money_refund>0)) THEN
  RETURN sales_lite2.drawer_page(p_shift_id,p_kind,p_method,p_page,p_page_size);
 END IF;
 RETURN public.get_cash_shift_movement_page(p_shift_id,p_kind,p_method,p_page,p_page_size);
 END $$;
 REVOKE ALL ON FUNCTION public.lite1_shift_movements2(UUID,TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.lite1_shift_movements2(UUID,TEXT,TEXT,INTEGER,INTEGER) TO authenticated;`;
}
