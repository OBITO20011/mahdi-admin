import {useCustomerStatement} from '../../hooks/useCustomerStatement';
import {Card,SectionHeader,MoneyText,UiButton,DataTable,Th,Tr,Td,formatUiDate} from '../../components/ui';
import type {CustomerStatementMovement} from '../../utils/customerStatement';
import {DocumentCorrectionAction} from '../corrections/DocumentCorrectionAction';

const date=(row:CustomerStatementMovement)=>row.occurred_at?formatUiDate(row.occurred_at,{
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
}):'تاريخ غير متاح';

export function CustomerStatement({customerId,revision,onChanged}:{customerId:string;revision:unknown;onChanged?:()=>void|Promise<void>}) {
  const {data,busy,error,loadMore,reload}=useCustomerStatement(customerId,revision);
  const correction=(row:CustomerStatementMovement)=>row.movement_type==='payment'&&/^payment:[0-9a-f-]{36}$/iu.test(row.movement_id)
    ?<DocumentCorrectionAction action="customer_payment" recordId={row.movement_id.slice(8)} onChanged={async()=>{reload();await onChanged?.();}}/>:null;
  return <Card className="min-w-0 space-y-4" data-testid="customer-statement" aria-busy={busy}>
    <SectionHeader title="كشف الحساب" hint="الحركات من الأحدث للأقدم؛ الرصيد محسوب زمنياً من أقدم حركة." />
    {data&&<>
      <div className="rounded-xl border border-nw-border bg-nw-surface-2 p-3">
        <span className="text-xs text-nw-muted">الرصيد الختامي</span>
        <p className="m-0 text-xl font-bold" data-testid="statement-closing"><MoneyText amount={data.closing_balance_in_minor_units/1000} currency /></p>
        <p className="m-0 text-xs text-nw-muted">الرصيد قبل أقدم حركة معروضة: <MoneyText amount={data.page_opening_balance_in_minor_units/1000} /></p>
      </div>
      {data.outstanding_cheques_in_minor_units!==undefined&&data.outstanding_cheques_in_minor_units>0&&<p className="m-0 text-sm text-nw-muted">
        منها شيكات لم تُصرف: <MoneyText amount={data.outstanding_cheques_in_minor_units/1000} /> — خُصمت عند الاستلام، وليست إضافة للرصيد.
      </p>}
      {!data.movements.length?<p className="text-sm text-nw-muted">لا توجد حركات ذمة لهذا العميل.</p>:<>
        <div className="space-y-3 md:hidden">
          {data.movements.map(row=><article key={row.movement_id} data-statement-movement={row.movement_id}
            className="space-y-2 rounded-xl border border-nw-border bg-nw-surface p-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h4 className="m-0 text-sm font-bold">{row.type_label}</h4><bdi className="text-xs text-nw-muted break-all">{row.reference}</bdi>
            </div>
            <p className="m-0 text-xs text-nw-muted"><bdi>{date(row)}</bdi></p>
            {correction(row)}
            {row.reason&&<p className="m-0 text-sm">السبب: {row.reason}</p>}
            {row.movement_type.startsWith('cheque_')&&row.movement_type.endsWith('_compensation')&&<p className="m-0 text-xs text-nw-muted">تاريخ أصل الدين: {row.original_debt_at?formatUiDate(row.original_debt_at,{year:'numeric',month:'2-digit',day:'2-digit'}):'عمر غير متاح'}</p>}
            <dl className="m-0 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-nw-muted">مدين</dt><dd className="m-0"><MoneyText amount={row.debit_in_minor_units/1000} /></dd></div>
              <div><dt className="text-nw-muted">دائن</dt><dd className="m-0"><MoneyText amount={row.credit_in_minor_units/1000} /></dd></div>
              <div><dt className="text-nw-muted">الرصيد</dt><dd className="m-0 font-bold"><MoneyText amount={row.balance_in_minor_units/1000} /></dd></div>
            </dl>
          </article>)}
        </div>
        <div className="hidden md:block"><DataTable caption="حركات كشف حساب العميل" style={{minWidth:650}}>
          <thead><tr>{['الحركة','المرجع','التاريخ','مدين','دائن','الرصيد'].map(label=><Th key={label}>{label}</Th>)}</tr></thead>
          <tbody>{data.movements.map(row=><Tr key={row.movement_id} data-statement-movement={row.movement_id}>
            <Td>{row.type_label}{correction(row)}{row.reason&&<p className="m-0 text-xs text-nw-muted">{row.reason}</p>}</Td><Td><bdi className="whitespace-nowrap">{row.reference}</bdi></Td>
            <Td><bdi className="whitespace-nowrap">{date(row)}</bdi></Td>
            <Td><MoneyText amount={row.debit_in_minor_units/1000} /></Td>
            <Td><MoneyText amount={row.credit_in_minor_units/1000} /></Td>
            <Td><MoneyText amount={row.balance_in_minor_units/1000} /></Td>
          </Tr>)}</tbody>
        </DataTable></div>
      </>}
    </>}
    {error&&<p role="alert" className="text-sm text-nw-warn">{error}</p>}
    {!data&&busy&&<p role="status" className="text-sm text-nw-muted">جاري تحميل كشف الحساب...</p>}
    <div className="flex flex-wrap gap-2">
      {data?.has_more&&<UiButton onClick={()=>void loadMore()} disabled={busy}>{busy?'جاري التحميل...':'تحميل المزيد'}</UiButton>}
      {error&&<UiButton onClick={reload} disabled={busy}>تحديث كشف الحساب</UiButton>}
    </div>
  </Card>;
}
