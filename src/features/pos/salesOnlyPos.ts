import type {PosV2Line} from '../../services/supabase/posV2.service';
import {fetchManualAvailability,type ProductAvailability} from '../../services/supabase/manualAvailability.service';

/** Same products (including mixed family) checked by the locked server writer. */
export function posAvailabilityIds(lines:readonly PosV2Line[]):string[]{
 return [...new Set(lines.flatMap(line=>line.commercial_line_kind==='configurable_parcel'
  ?[line.family_product_id,...line.parcel_instances.flatMap(p=>p.components.map(c=>c.product_id))]
  :[line.product_id]))].sort();
}
export async function readPosAvailability(lines:readonly PosV2Line[],read=fetchManualAvailability):Promise<ProductAvailability[]>{
 const ids=posAvailabilityIds(lines),products:ProductAvailability[]=[];
 for(let i=0;i<ids.length;i+=200){
  const result=await read(ids.slice(i,i+200));
  if(result.fullAccounting)throw Error('POS_MODE_CHANGED');
  products.push(...result.products);
 }
 return products;
}
