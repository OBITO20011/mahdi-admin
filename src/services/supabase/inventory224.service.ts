import {isSupabaseConfigured,supabase} from '../../lib/supabase';
import {inventoryReadError,normalizeInventorySearch,parseInventory224,type InventoryFilter} from '../../features/operatingMode/inventory224Contract';
import {searchAdminProducts} from './products.service';
import {fetchOptionalQuantity,type OptionalQuantityRow} from './optionalQuantity.service';

export async function fetchInventory224(search:string,filter:InventoryFilter,page:number){
 const normalized=normalizeInventorySearch(search);
 if(!isSupabaseConfigured||!supabase||normalized.length>256||!['all','low','zero'].includes(filter)||!Number.isInteger(page)||page<1||page>100000)throw inventoryReadError();
 const request={search:normalized,filter,page,pageSize:20};
 const {data,error}=await supabase.rpc('lite3_counters224',{p_search:normalized,p_filter:filter,p_page:page,p_page_size:20});
 if(error)throw inventoryReadError();return parseInventory224(data,request);
}
export async function searchNewCounters224(search:string):Promise<OptionalQuantityRow[]>{
 const normalized=normalizeInventorySearch(search);
 if(normalized.length>100)throw inventoryReadError();
 // Existing bounded SQL search; never download/filter the complete catalog.
 const products=await searchAdminProducts({search:normalized,limit:24,purpose:'any'});
 const sellable=products.filter(p=>!p.isFlavorMaster);
 const contexts=await Promise.all(sellable.map(p=>fetchOptionalQuantity(p.id)));
 return contexts.flatMap(context=>context.isFamily?[]:context.products);
}
