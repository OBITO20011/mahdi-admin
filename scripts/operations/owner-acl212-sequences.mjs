// Exact catalog metadata, never sequence state or a change to a sequence.
// The immutable migrations define these14 sequences as bigint with its default
// MAXVALUE. Old JSON snapshots rounded that one boundary in JavaScript.
import assert from 'node:assert/strict';
const defaultBigintSequences=new Set(['admin_ai_assistant_usage_events_id_seq','cash_shift_number_seq',
 'customer_collection_operation_number_seq','customer_opening_balance_number_seq','customer_payment_number_seq',
 'deferred_cheque_number_seq','inventory_movement_mutation_seq','inventory_opening_session_number_seq',
 'operational_expense_number_seq','owner_cash_withdrawal_number_seq','pos_sale_number_seq','sales_return_number_seq',
 'supplier_opening_balance_number_seq','supplier_receipt_seq']);
export const exactBigintSequenceMax='9223372036854775807';
export function ownerSequenceMetadata(row){
 const out={...row};
 for(const field of ['start','increment','max','min','cache']){
  const value=row[field];
  if(field==='max'&&value===Number(exactBigintSequenceMax)&&defaultBigintSequences.has(row.name))out[field]=exactBigintSequenceMax;
  else{assert.ok(Number.isSafeInteger(value),'OWNER_ACL212_UNREVIEWED_SEQUENCE_BOUND');out[field]=String(value);}
 }
 return out;
}
