import type {CustomerStatementPage,CustomerStatementMovement} from '../src/utils/customerStatement';

/** Fixed demonstration facts only;never a financial write or app fallback. */
export function customerStatementFixture(customerId:string,balance:number,page=1,size=25):CustomerStatementPage {
  let running=0;
  const ascending:CustomerStatementMovement[]=Array.from({length:28},(_,index)=>{
    const debit=index===0?50000:index===1?balance-10000:0;
    const credit=index<2?0:index===27?2500:1500;
    running+=debit-credit;
    return {movement_id:`statement-${index+1}`,movement_type:index<2?'sale_debt':'payment',
      type_label:index<2?'دين بيع':'دفعة عميل',order_id:'fa100000-0000-4000-8000-000000000001',
      reference:index<2?`W-${10470+index}`:`RCPT-${1000+index}`,
      occurred_at:index===0?null:new Date(Date.UTC(2026,9,1+Math.floor(index/4),10,index%4)).toISOString(),
      date_label:index===0?'تاريخ غير متاح':null,debit_in_minor_units:debit,credit_in_minor_units:credit,
      balance_in_minor_units:running,sequence:index+1};
  });
  const rows=ascending.reverse().slice((page-1)*size,page*size),oldest=rows.at(-1);
  return {customer_id:customerId,page,page_size:size,total_count:28,has_more:page*size<28,
    closing_balance_in_minor_units:balance,page_opening_balance_in_minor_units:oldest?
      oldest.balance_in_minor_units-oldest.debit_in_minor_units+oldest.credit_in_minor_units:0,
    page_closing_balance_in_minor_units:rows[0]?.balance_in_minor_units??0,movements:rows};
}
