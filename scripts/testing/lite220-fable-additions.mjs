// Owner11Nov:changes ONLY new lite definitions;all original627/nine hunks frozen.
import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{liteReceivableReadersSql}from'./lite220-fable-readers.mjs';
const once=(text,from,to)=>{assert.equal(text.split(from).length,2,'FABLE_EXACT_NEW_LITE_HUNK:'+from.slice(0,65));return text.replace(from,()=>to);};
export const liteShiftReason='هذه الوردية تتبع وضع البيع المبسّط. لا يمكن إلغاؤها أو عكس عملياتها؛ استخدم المرتجع وعدّ الدرج والإغلاق اليومي.';
export function withFableAdditions(body,rows){
 // M2:no real reservation exists. The preserved full expiry scan already
 // requires reservation_released_at IS NULL;guest replay writes nothing again.
 body=once(body,'delivery_zone,promotion_code_id,promotion_code_snapshot,tracking_token,customer_notes)\n VALUES',
  'delivery_zone,promotion_code_id,promotion_code_snapshot,tracking_token,customer_notes,reservation_released_at)\n VALUES');
 body=once(body,"zone,promo_id,promotion,tracking,NULLIF(btrim(recipient->>'customerNotes'),''));",
  "zone,promo_id,promotion,tracking,NULLIF(btrim(recipient->>'customerNotes'),''),clock_timestamp());");
 // M3:retains every original private integrity term;adds one extra condition.
 const start=body.indexOf('CREATE FUNCTION sales_lite1.integrity_count()'),end=body.indexOf('\n$$;',start);assert.ok(start>=0&&end>start,'FABLE_INTEGRITY_FUNCTION_REQUIRED');
 const original=body.slice(start,end);assert.ok(original.endsWith(';'),'FABLE_INTEGRITY_TERMINATOR');body=body.slice(0,start)+original.slice(0,-1)+`\n +(SELECT count(*) FROM (SELECT order_id,sum(money_refund) AS refunded FROM sales_lite1.returns GROUP BY order_id) r\n JOIN public.orders o ON o.id=r.order_id WHERE r.refunded>o.amount_paid_in_minor_units);`+body.slice(end);
 // M4:the exact original full-only preview is called first for auth/MFA.
 const predicate=`EXISTS(SELECT 1 FROM sales_lite1.shifts s WHERE s.shift_id=OLD.id)\n OR EXISTS(SELECT 1 FROM public.orders o JOIN sales_lite1.orders l ON l.order_id=o.id WHERE o.cash_shift_id=OLD.id)`;
 body=once(body," IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN('cancelled','reversed')\n AND EXISTS(SELECT 1 FROM sales_lite1.returns",
  ` IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN('cancelled','reversed') AND(${predicate}) THEN\n  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='${liteShiftReason}';\n END IF;\n IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN('cancelled','reversed')\n AND EXISTS(SELECT 1 FROM sales_lite1.returns`);
 body=once(body,' result:=public.preview_cash_shift_full_reversal(p_shift_id);',` result:=public.preview_cash_shift_full_reversal(p_shift_id);
 IF EXISTS(SELECT 1 FROM sales_lite1.shifts s WHERE s.shift_id=p_shift_id)
 OR EXISTS(SELECT 1 FROM public.orders o JOIN sales_lite1.orders l ON l.order_id=o.id WHERE o.cash_shift_id=p_shift_id) THEN
  RETURN result||jsonb_build_object('canExecute',false,'liteShiftBlocked',true,'operations',
   COALESCE(result->'operations','[]'::JSONB)||jsonb_build_array(jsonb_build_object('operationType','lite_shift',
    'originalRecordId',p_shift_id,'status','BLOCKED','reason','${liteShiftReason}','expectedEffect','{}'::JSONB)));
 END IF;`);
 return body+'\n'+liteReceivableReadersSql(rows)+'\n'+readFileSync(new URL('../../docs/design/sales-only-phase3/collection-refund-guard.sql',import.meta.url),'utf8')+`
 CREATE INDEX lite3_returns_order_id_idx ON sales_lite1.returns(order_id);
 CREATE INDEX lite3_returns_item_id_idx ON sales_lite1.returns(item_id);
 CREATE INDEX lite3_returns_shift_id_idx ON sales_lite1.returns(shift_id);
 REVOKE ALL ON FUNCTION public.lite1_expense(UUID,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
 `;
}
