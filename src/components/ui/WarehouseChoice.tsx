import {useLayoutEffect,type ReactNode} from 'react';

import {singleWarehouseOption,type WarehouseChoiceOption} from './singleWarehouseOption';
/** Only removes a redundant question. Existing selectors/handlers/payloads
 * remain the authority whenever a real choice exists or an old edit is kept. */
export function WarehouseChoice({options,branchId,value,onSingle,children,preserveSelected=false,enabled=true}:{
  options:readonly WarehouseChoiceOption[];branchId?:string|null;value:string;
  onSingle?:(id:string)=>void;children:ReactNode;preserveSelected?:boolean;enabled?:boolean;
}){
  const one=enabled?singleWarehouseOption(options,branchId):null;
  const sole=one&&(!preserveSelected||!value||value===one.id)?one:null;
  useLayoutEffect(()=>{if(sole&&value!==sole.id)onSingle?.(sole.id);},[sole,value,onSingle]);
  if(!sole)return <>{children}</>;
  return <p data-single-warehouse={sole.id} className="flex min-h-11 items-center rounded-xl border border-nw-border bg-nw-surface-2 px-3 text-sm text-nw-text">
    {sole.nameAr||sole.name||'مستودع المحل'}
  </p>;
}
