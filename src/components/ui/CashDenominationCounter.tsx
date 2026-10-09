import React, {useState} from 'react';
import {MoneyText} from './DataDisplay';
import {UiButton} from './Controls';

import {cashDenominations,countedCashMinorUnits} from './cashCounting';
export function CashDenominationCounter({disabled,onApply}:{disabled:boolean;onApply:(value:string)=>void}) {
  const [counts,setCounts]=useState<string[]>(cashDenominations.map(()=>'')),[coins,setCoins]=useState('');
  const total=countedCashMinorUnits(counts,coins);
  return <fieldset disabled={disabled} className="space-y-2">
    <legend className="mb-2 text-xs text-nw-muted">عدّ النقد حسب الفئة (اختياري)</legend>
    {cashDenominations.map((value,index)=><label key={value} className="grid grid-cols-[1fr_84px_90px] items-center gap-2 text-sm">
      <span>{value} دينار</span><input aria-label={`عدد فئة ${value} دينار`} inputMode="numeric" type="number" min="0" step="1"
        value={counts[index]} onChange={e=>setCounts(current=>current.map((v,i)=>i===index?e.target.value:v))}
        className="h-11 min-w-0 rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-center text-nw-text" />
      <span className="text-left font-semibold"><MoneyText amount={Number(counts[index]||0)*value}/></span>
    </label>)}
    <label className="grid grid-cols-[1fr_84px_90px] items-center gap-2 text-sm"><span>فكة (مبلغ)</span>
      <input aria-label="الفكة كمبلغ" type="number" inputMode="decimal" min="0" step="0.001" value={coins} onChange={e=>setCoins(e.target.value)}
        className="h-11 min-w-0 rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-center text-nw-text" />
      <span className="text-left font-semibold"><MoneyText amount={Number(coins||0)}/></span></label>
    <UiButton disabled={disabled||total===undefined} onClick={()=>{if(total!==undefined)onApply((total/1000).toFixed(3));}} className="w-full">
      اعتماد العد في المبلغ <span data-testid="cash-count-total">{total===undefined?'غير صالح':<MoneyText amount={total/1000}/>}</span>
    </UiButton>
  </fieldset>;
}
