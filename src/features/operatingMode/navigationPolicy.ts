import type {OperatingMode} from '../../services/supabase/operatingMode.service';
import type {AdminNavigationGroup} from '../more/adminNavigation.config';

// A presentation filter only; it never replaces existing role/RPC guards.
const accountingTabs=new Set(['inventory','purchases','assistant']);
const accountingModals=new Set(['adjust_stock','damage_stock_selection','supplier_replacement','receive_goods','warehouse_transfer','stock_count','inventory_opening_setup']);
export function allowsOperatingDestination(type:'tab'|'modal',destination:string,mode:OperatingMode):boolean {
 return mode==='full'||!(type==='tab'?accountingTabs:accountingModals).has(destination);
}
export function operatingNavigation(groups:readonly AdminNavigationGroup[],mode:OperatingMode):AdminNavigationGroup[]{
 if(mode==='full')return [...groups];
 return groups.map(group=>({...group,
  ...(group.id==='products-inventory'?{label:'المنتجات والطرود'}:{}),
  items:group.items.filter(item=>allowsOperatingDestination(item.action.type,item.action.destination,mode)).map(item=>{
   if(item.id==='finance-reports')return {...item,description:'المبيعات والذمم والورديات والمصروفات دون تكلفة أو أرباح'};
   if(item.id==='finance-cheques')return {...item,description:'شيكات العملاء وتحصيلها ومواعيد الاستحقاق'};
   if(item.id==='admin-go-live')return {...item,description:'المنتجات وديون العملاء وشيكات البداية والدرج الافتتاحي'};
   return item;
  }),
 })).filter(group=>group.items.length>0);
}
