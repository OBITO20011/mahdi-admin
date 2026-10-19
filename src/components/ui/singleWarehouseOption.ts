export interface WarehouseChoiceOption {id:string;branchId?:string|null;name?:string;nameAr?:string;isActive?:boolean}
export function singleWarehouseOption<T extends WarehouseChoiceOption>(options:readonly T[],branchId?:string|null):T|null {
  const active=options.filter(w=>w.isActive!==false&&(!branchId||w.branchId===branchId));
  return active.length===1?active[0]:null;
}
