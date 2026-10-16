export interface CustomerStatementMovement {
  movement_id: string;
  movement_type: string;
  type_label: string;
  order_id: string | null;
  reference: string;
  occurred_at: string | null;
  date_label: string | null;
  debit_in_minor_units: number;
  credit_in_minor_units: number;
  balance_in_minor_units: number;
  sequence: number;
  original_debt_at?: string | null;
  reason?: string | null;
}
export interface CustomerStatementPage {
  customer_id: string;
  page: number;
  page_size: number;
  total_count: number;
  has_more: boolean;
  closing_balance_in_minor_units: number;
  page_opening_balance_in_minor_units: number;
  page_closing_balance_in_minor_units: number;
  movements: CustomerStatementMovement[];
  outstanding_cheques_in_minor_units?: number;
  has_returned_cheque?: boolean;
}
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Validate the read contract,not a second calculation of financial authority. */
export function readCustomerStatement(value:unknown):CustomerStatementPage|null {
  if(!record(value)||typeof value.customer_id!=='string'||typeof value.has_more!=='boolean'
    ||!Array.isArray(value.movements))return null;
  for(const key of ['page','page_size','total_count','closing_balance_in_minor_units',
    'page_opening_balance_in_minor_units','page_closing_balance_in_minor_units'])if(!integer(value[key]))return null;
  if(Number(value.page)<1||Number(value.page_size)<1||Number(value.page_size)>100
    ||Number(value.total_count)<0||Number(value.closing_balance_in_minor_units)<0
    ||value.movements.length>Number(value.page_size))return null;
  if(value.outstanding_cheques_in_minor_units!==undefined&&(!integer(value.outstanding_cheques_in_minor_units)||value.outstanding_cheques_in_minor_units<0))return null;
  if(value.has_returned_cheque!==undefined&&typeof value.has_returned_cheque!=='boolean')return null;
  const ids=new Set<string>();let previousSequence=Infinity;
  for(const row of value.movements){
    if(!record(row))return null;
    for(const key of ['movement_id','movement_type','type_label','reference'])if(typeof row[key]!=='string')return null;
    // Opening balances and independent cheque claims are NOT order movements.
    // SQL returns an explicit NULL,not a fabricated order identity.
    if(row.order_id!==null&&typeof row.order_id!=='string')return null;
    if(row.reason!==undefined&&row.reason!==null&&typeof row.reason!=='string')return null;
    if(row.original_debt_at!==undefined&&row.original_debt_at!==null
      &&(typeof row.original_debt_at!=='string'||!Number.isFinite(Date.parse(row.original_debt_at))))return null;
    for(const key of ['debit_in_minor_units','credit_in_minor_units','balance_in_minor_units','sequence'])if(!integer(row[key]))return null;
    if(Number(row.debit_in_minor_units)<0||Number(row.credit_in_minor_units)<0||Number(row.sequence)<1
      ||Number(row.sequence)>=previousSequence||ids.has(String(row.movement_id)))return null;
    if(row.occurred_at!==null&&(typeof row.occurred_at!=='string'||!Number.isFinite(Date.parse(row.occurred_at))))return null;
    if(row.occurred_at===null?row.date_label!=='تاريخ غير متاح':row.date_label!==null)return null;
    ids.add(String(row.movement_id));previousSequence=Number(row.sequence);
  }
  const page=value as unknown as CustomerStatementPage;
  let balance=page.page_opening_balance_in_minor_units;
  for(const row of [...page.movements].reverse()){
    balance+=row.debit_in_minor_units-row.credit_in_minor_units;
    if(balance!==row.balance_in_minor_units)return null;
  }
  if(balance!==page.page_closing_balance_in_minor_units)return null;
  if(page.page===1&&page.movements.length&&balance!==page.closing_balance_in_minor_units)return null;
  return page;
}

export function appendCustomerStatementPage(current:CustomerStatementPage,next:CustomerStatementPage):CustomerStatementPage|null {
  if(current.customer_id!==next.customer_id||next.page!==current.page+1||current.page_size!==next.page_size
    ||current.closing_balance_in_minor_units!==next.closing_balance_in_minor_units
    ||current.total_count!==next.total_count||current.page_opening_balance_in_minor_units!==next.page_closing_balance_in_minor_units
    ||next.movements.some(row=>current.movements.some(old=>old.movement_id===row.movement_id)))return null;
  if(current.movements.length&&next.movements.length
    &&next.movements[0].sequence!==current.movements.at(-1)!.sequence-1)return null;
  return {...next,movements:[...current.movements,...next.movements],
    page_closing_balance_in_minor_units:current.page_closing_balance_in_minor_units};
}
