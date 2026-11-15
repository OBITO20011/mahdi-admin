import {useState,type InputHTMLAttributes} from 'react';
import {offParcelPricePresentation} from '../../utils/offParcelPricePresentation';

/** Formatting is confined to the display. Existing value/change handlers own the price. */
export function OffPriceInput({value,onFocus,onBlur,...props}:InputHTMLAttributes<HTMLInputElement>){
  const [focused,setFocused]=useState(false);
  const [formatted,setFormatted]=useState(false);
  const display=value!==''&&value!==undefined&&Number.isFinite(Number(value))
    ? Number(value).toFixed(3) : value;
  return <input {...props} lang="en" value={focused||!formatted?value:display}
    onFocus={event=>{setFocused(true);onFocus?.(event);}}
    onBlur={event=>{setFocused(false);setFormatted(true);onBlur?.(event);}}/>;
}

export function OffParcelPriceSummary({units,single,parcel,unit}:{
  units:number;single:number;parcel:number;unit:string;
}){
  const summary=offParcelPricePresentation(units,single,parcel,unit);
  return <div aria-live="polite" aria-atomic="true" className="space-y-1 text-sm" data-off-parcel-price-summary>
    {summary.formula&&<p className="font-bold">{summary.formula}</p>}
    <p className={summary.tone==='error'?'font-bold text-nw-bad'
      :summary.tone==='discount'?'font-bold text-nw-ok':'text-nw-muted'}
      role={summary.tone==='error'?'alert':undefined}>{summary.detail}</p>
  </div>;
}
