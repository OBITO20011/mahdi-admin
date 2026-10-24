import {CashSourceDocumentLines} from './CashSourceDocumentLines';
import {Modal} from '../../components/common/Modal';
import {MoneyText,formatUiDate} from '../../components/ui';
import type {CashShiftMovement} from '../../services/supabase/cashShiftMovements.service';
import {lazy,Suspense} from 'react';
const SalesInvoiceDialog=lazy(()=>import('../salesHistory/SalesInvoiceDialog').then(module=>({default:module.SalesInvoiceDialog}))); 

const names:Record<NonNullable<CashShiftMovement['document']>['type'],string>={order:'فاتورة البيع',supplier_receipt:'سند استلام بضاعة',purchase_order:'طلب الشراء',supplier_payment:'دفعة المورد',customer_collection:'سند قبض الزبون',expense:'سند المصروف',owner_withdrawal:'سند سحب المالك',owner_withdrawal_return:'سند إرجاع سحب المالك'};
export function CashMovementDocument({movement,onClose}:{movement:CashShiftMovement;onClose:()=>void}) {
  if(movement.document?.type==='order')return <Suspense fallback={<p role="status">جاري فتح الفاتورة…</p>}><SalesInvoiceDialog nested orderId={movement.document.id} onClose={onClose}/></Suspense>;
  return <Modal isOpen onClose={onClose} trackChanges={false} title={movement.document?names[movement.document.type]:'المستند'}>
    <article className="space-y-4" data-testid="cash-movement-document">
      <h3 className="break-words text-lg font-bold">{movement.displayTitle}</h3>
      <p className="text-xs text-nw-muted"><bdi>{movement.reference}</bdi> · {formatUiDate(movement.at,{dateStyle:'short',timeStyle:'short'})}</p>
      <dl className="space-y-3 text-sm"><div><dt>مبلغ الحركة</dt><dd><MoneyText amount={movement.amountInMinorUnits/1000} currency/></dd></div>
        <div><dt>طريقة الدفع</dt><dd>{movement.method==='cash'?'كاش':movement.method==='cliq'?'CliQ':'بطاقة'}</dd></div>
        {movement.note&&<div><dt>البيان</dt><dd className="break-words">{movement.note}</dd></div>}
      </dl>
      {movement.document&&['supplier_receipt','purchase_order'].includes(movement.document.type)&&<CashSourceDocumentLines document={movement.document}/>}
    </article>
  </Modal>;
}
