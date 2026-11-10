// Focused PostgreSQL guard matrix, not an opening-epoch rehearsal. The ON
// mode is an explicit ROLLBACK-only fixture; no activation is claimed here.
import assert from 'node:assert/strict';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {liteShiftReason} from './lite220-fable-additions.mjs';

export async function verifyFableShiftPersistence(c,report){
 const {sql,json,q,j,id,executor,markedShift,invoiceShift}=c;
 const before=await readApplicationFingerprint(executor);
 assert.equal(await sql('SELECT sales_lite1.enabled();'),'t');
 const result=await json(`BEGIN;
 UPDATE sales_lite1.mode SET full_accounting=true WHERE id;
 DELETE FROM sales_lite1.shifts WHERE shift_id=${q(invoiceShift)};
 SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);
 DO $guard$ DECLARE shift UUID;target TEXT;blocked BOOLEAN;BEGIN
 FOREACH shift IN ARRAY ARRAY[${q(markedShift)},${q(invoiceShift)}]::UUID[] LOOP
  FOREACH target IN ARRAY ARRAY['cancelled','reversed'] LOOP
   blocked:=false;
   BEGIN UPDATE public.cash_shifts SET status=target WHERE cash_shifts.id=shift;
   EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM<>${q(liteShiftReason)} THEN RAISE;END IF;
    blocked:=true;
   END;
   IF NOT blocked THEN RAISE EXCEPTION 'LITE_GUARD_DID_NOT_PERSIST:%:%',shift,target;END IF;
  END LOOP;
 END LOOP;
 END $guard$;
 SELECT jsonb_build_object('marked',public.lite1_preview_shift_reversal2(${q(markedShift)}),
  'invoiceWithoutMarker',public.lite1_preview_shift_reversal2(${q(invoiceShift)}),
  'modeFull',(SELECT full_accounting FROM sales_lite1.mode WHERE id),
  'invoiceMarkerCount',(SELECT count(*) FROM sales_lite1.shifts WHERE shift_id=${q(invoiceShift)}));
 ROLLBACK;`);
 assert.equal(result.modeFull,true);assert.equal(result.invoiceMarkerCount,0);
 for(const preview of [result.marked,result.invoiceWithoutMarker]){
  assert.equal(preview.canExecute,false);assert.equal(preview.liteShiftBlocked,true);
  assert.ok(preview.operations.some(row=>row.operationType==='lite_shift'&&row.reason===liteShiftReason));
 }
 assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables);
 assert.equal(await sql('SELECT sales_lite1.enabled();'),'t');
 assert.equal(await sql(`SELECT count(*) FROM sales_lite1.shifts WHERE shift_id=${q(invoiceShift)};`),'1');
 report.shiftPersistence={markedAndInvoiceBranches:true,explicitModeOnFixture:true,
  realOpeningEpochClaimed:false,cancelAndReverseBothDenied:true,arabicReasonExact:true,rowsRolledBack:true};
}
