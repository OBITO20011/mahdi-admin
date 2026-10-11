import {SegmentedControl} from './Controls';
import {PURCHASE_PACKAGE_OPTIONS} from '../../constants';
export type ReceivingUnitMode='base_unit'|'package';
interface Props {
 unitName:string;mode:ReceivingUnitMode;hasPackage:boolean;quantity:number;
 unitsPerPackage:number;priceJod:number;packageName:string;disabled?:boolean;minimum?:number;maximum?:number;
 onMode:(mode:ReceivingUnitMode)=>void;onQuantity:(value:number)=>void;
 onContents:(value:number)=>void;onPrice:(value:number)=>void;onPackageName:(value:string)=>void;
}
/** Input convenience only. No WAC or inventory business calculation lives here. */
export function ReceivingUnitFields(p:Props){
 const label=p.mode==='base_unit'?p.unitName:'طرد';
 return <div className="min-w-0 space-y-3">
  <SegmentedControl touchSize label="وحدة الاستلام" value={p.mode} disabled={p.disabled}
   options={p.hasPackage?[{value:'base_unit',label:p.unitName},{value:'package',label:'طرد'}]:[{value:'base_unit',label:p.unitName}]}
   onChange={p.onMode}/>
  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
   <label className="min-w-0 space-y-1 text-sm">كم {label}؟<input className="w-full" aria-label={`كم ${label}؟`} type="number" inputMode="numeric" step="1" min={p.minimum??1} max={p.maximum} disabled={p.disabled} value={p.quantity} onChange={e=>p.onQuantity(Number(e.target.value))}/></label>
   {p.mode==='package'&&<label className="min-w-0 space-y-1 text-sm">كم {p.unitName} بالطرد؟<input className="w-full" aria-label={`كم ${p.unitName} بالطرد؟`} type="number" inputMode="numeric" min="1" step="1" disabled={p.disabled} value={p.unitsPerPackage} onChange={e=>p.onContents(Number(e.target.value))}/></label>}
   <label className="min-w-0 space-y-1 text-sm">سعر {label}<input className="w-full" aria-label={`سعر ${label}`} type="number" min="0" step="0.001" disabled={p.disabled} value={p.priceJod} onChange={e=>p.onPrice(Number(e.target.value))}/></label>
   {p.mode==='package'&&<label className="min-w-0 space-y-1 text-sm">نوع الطرد<select className="w-full" aria-label="نوع الطرد" disabled={p.disabled} value={p.packageName} onChange={e=>p.onPackageName(e.target.value)}>{Array.from(new Set([p.packageName,...PURCHASE_PACKAGE_OPTIONS.map(option=>option.nameAr)])).map(name=><option key={name} value={name}>{name}</option>)}</select></label>}
  </div>
  <p role="status" className="m-0 text-sm font-semibold text-nw-info">سيدخل المخزون: <bdi>{p.quantity*(p.mode==='base_unit'?1:p.unitsPerPackage)}</bdi> {p.unitName}</p>
 </div>;
}
