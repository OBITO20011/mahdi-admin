import {DISPLAY_LOCALE} from '../../customer-web/src/utils/displayLocale';

// Presentation only: callers retain the existing stock predicates and amounts.
export const POS_STOCK_CHANGED_COPY='تغيّر المخزون قبل إتمام البيع. حدّث المتاح وراجع السلة';
export function posStockShortageCopy(name:string,unit:string|undefined,available:number,requested:number):string {
  const label=unit?.trim()||'باكيت';
  const count=(value:number)=>value.toLocaleString(DISPLAY_LOCALE);
  return available<=0
    ? `نفد المخزون: ${name} — المتاح 0 ${label}`
    : `المتاح من ${name}: ${count(available)} ${label}، والمطلوب ${count(requested)}`;
}
