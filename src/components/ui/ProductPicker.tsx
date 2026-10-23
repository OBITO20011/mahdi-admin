import {useId,useState} from 'react';
import {ProductGlyph} from './ProductGlyph';
import {SearchField} from './Controls';

export type {ProductPickerOption} from './productPickerModel';
import {orderProductChoices,type ProductPickerOption} from './productPickerModel';

function PickerImage({name,image}:{name:string;image?:string}) {
  const [failed,setFailed]=useState<string>();
  return <span className="shrink-0" onErrorCapture={()=>setFailed(image)}><ProductGlyph name={name} image={failed===image?undefined:image} className="h-10 w-10"/></span>;
}

/** Search remains controlled by the caller's existing server read. No stock,
 * price, eligibility or selection mutation is inferred by this presentation. */
export function ProductChoiceList({label,options,value,onChoose,disabled=false,loading=false,empty='لا توجد أصناف مطابقة.'}:{
  label:string;options:readonly ProductPickerOption[];value?:string;onChoose:(id:string)=>void;
  disabled?:boolean;loading?:boolean;empty?:string;
}) {
  const id=useId(),ordered=orderProductChoices(options);
  return <div className="min-w-0 space-y-2" aria-busy={loading}>
    {loading?<p role="status" className="text-sm text-nw-muted">جاري البحث في الأصناف…</p>:ordered.length===0?<p role="status" className="text-sm text-nw-muted">{empty}</p>:<ul
      id={id} aria-label={label} className="m-0 max-h-64 list-none space-y-1 overflow-y-auto overscroll-contain p-0">
      {ordered.map(option=><li key={option.id}>
        <button type="button" disabled={disabled} aria-pressed={value===undefined?undefined:value===option.id}
          data-product-choice={option.id} data-receiving-product-result={option.id} onClick={()=>onChoose(option.id)}
          className={`flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-right disabled:cursor-wait ${value===option.id?'border-nw-primary bg-nw-sel-row':'border-nw-border bg-nw-surface hover:bg-nw-surface-2'} ${option.available===0?'opacity-60':''}`}>
          <PickerImage name={option.name} image={option.image}/>
          <span className="min-w-0 flex-1"><b className="block break-words text-sm text-nw-text">{option.name}</b>
            {option.available!==null&&<span className="block text-xs text-nw-muted">المتاح {option.available} {option.unit}</span>}
          </span>
          {value===option.id&&<span aria-label="الصنف المحدد" className="shrink-0 text-nw-primary">✓</span>}
        </button>
      </li>)}
    </ul>}
  </div>;
}

export function ProductPicker({label,search,onSearch,...props}:{label:string;search:string;onSearch:(value:string)=>void}&Omit<Parameters<typeof ProductChoiceList>[0],'label'>) {
  return <section className="min-w-0 space-y-2" aria-label={label}>
    <h4 className="text-sm font-semibold text-nw-text">{label}</h4>
    <SearchField label={`بحث ${label}`} placeholder="اسم الصنف أو الباركود أو رمز الصنف" value={search}
      disabled={props.disabled} onChange={event=>onSearch(event.target.value)}/>
    <ProductChoiceList {...props} label={`خيارات ${label}`}/>
  </section>;
}
