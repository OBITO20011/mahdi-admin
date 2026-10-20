import {useEffect,useRef,useState} from 'react';
import type {Shift} from '../../types';
import {useAuthStore} from '../../stores/useAuthStore';
import {hasNavigationRole} from '../more/adminNavigation.config';
import {CashFlowDetails} from './CashFlowDetails';
import {MoneyText} from '../../components/ui';
import {cashFlowRows,type CashFlowRow} from './cashFlowModel';

export function CashFlowSummary({shift,onSelect}:{shift:Shift;onSelect?:(row:CashFlowRow)=>void}) {
  const {roleName,roles}=useAuthStore();
  const canRead=hasNavigationRole(['owner','admin','manager','accountant'],roleName,roles);
  const [selected,setSelected]=useState<CashFlowRow|null>(null);
  const container=useRef<HTMLElement>(null);
  useEffect(()=>{
    const root=container.current;if(!root)return;
    const opened=new Set<HTMLDetailsElement>(),media=window.matchMedia('print');
    const expand=()=>{root.querySelectorAll<HTMLDetailsElement>('details:not([open])').forEach(item=>{opened.add(item);item.open=true;});};
    const restore=()=>{opened.forEach(item=>{item.open=false;});opened.clear();};
    const changed=()=>{if(media.matches)expand();else restore();};
    window.addEventListener('beforeprint',expand);window.addEventListener('afterprint',restore);media.addEventListener('change',changed);
    if(media.matches)expand();
    return()=>{window.removeEventListener('beforeprint',expand);window.removeEventListener('afterprint',restore);media.removeEventListener('change',changed);restore();};
  },[]);
  const select=canRead?(onSelect??setSelected):undefined;
  const rows=cashFlowRows(shift);
  const row=(item:CashFlowRow)=><div key={`${item.kind}:${item.method}`} data-cash-flow={`${item.kind}:${item.method}`} className="flex min-h-11 items-center justify-between gap-3 border-b border-nw-border py-1 text-sm last:border-0">
    {select?<button type="button" className="min-h-11 text-right underline decoration-dotted underline-offset-4 print:no-underline" onClick={()=>select(item)} aria-label={`تفصيل ${item.label}`}>{item.label}</button>:<span>{item.label}</span>}
    <strong className={item.direction==='in'?'text-nw-ok':'text-nw-bad'}><bdi dir="ltr">{item.direction==='in'&&'+'}<MoneyText amount={item.direction==='out'?-item.amount:item.amount}/></bdi></strong>
  </div>;
  const list=(items:CashFlowRow[])=> <>
    {items.filter(item=>item.amount!==0).map(row)}
    {items.some(item=>item.amount===0)&&<details className="cash-flow-details"><summary className="min-h-11 cursor-pointer py-3 text-xs text-nw-muted">بنود بلا حركة ({items.filter(item=>item.amount===0).length})</summary><div>{items.filter(item=>item.amount===0).map(row)}</div></details>}
  </>;
  return <section ref={container} data-testid="cash-flow-summary" aria-label="حركة الدرج" className="space-y-3">
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-nw-border text-sm"><span>رصيد افتتاحي</span><MoneyText amount={shift.openingCash}/></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="min-w-0 rounded-xl border border-nw-ok/30 p-3"><h3 className="m-0 text-sm font-bold text-nw-ok">داخل (+)</h3>{list(rows.filter(item=>item.method==='cash'&&item.direction==='in'))}</section>
      <section className="min-w-0 rounded-xl border border-nw-bad/30 p-3"><h3 className="m-0 text-sm font-bold text-nw-bad">طالع (−)</h3>{list(rows.filter(item=>item.method==='cash'&&item.direction==='out'))}</section>
    </div>
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-nw-surface-2 px-3 text-sm font-bold"><span>النقد المتوقع بالدرج</span><MoneyText amount={shift.expectedCash} currency/></div>
    <details className="cash-flow-details rounded-xl border border-nw-border px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">خارج الدرج · CliQ والبطاقة</summary><p className="text-xs text-nw-muted">هذه المبالغ لا تدخل النقد بالدرج. البيع الآجل يبقى في الذمم.</p><div>{list(rows.filter(item=>item.method!=='cash'))}</div></details>
    {canRead&&selected&&<CashFlowDetails key={`${shift.id}:${selected.kind}:${selected.method}`} shiftId={shift.id} row={selected} onClose={()=>setSelected(null)}/>}
  </section>;
}
