import {supabase} from '../../lib/supabase';

export interface ManagedBranch {id:string;code:string;name:string;isActive:boolean}
export interface ManagedWarehouse {
  id:string;code:string;name:string;branchId:string|null;isActive:boolean;updatedAt:string;
  hasStockOrReservations:boolean;hasMovements:boolean;hasProductAssociations:boolean;
}
export interface WarehouseAdministration {branches:ManagedBranch[];warehouses:ManagedWarehouse[]}
export interface SaveWarehouseInput {id:string;code:string;name:string;branchId:string;isActive:boolean;expectedUpdatedAt:string|null}
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('استجابة المستودعات غير مكتملة.');
  return value as Record<string,unknown>;
};
const text=(value:unknown)=>{if(typeof value!=='string')throw Error('بيانات المستودعات غير مكتملة.');return value;};
const boolean=(value:unknown)=>{if(typeof value!=='boolean')throw Error('حالة المستودع غير صالحة.');return value;};
const list=(value:unknown)=>{if(!Array.isArray(value))throw Error('قائمة المستودعات غير مكتملة.');return value as unknown[];};
export function readWarehouseAdministration(value:unknown):WarehouseAdministration {
  const data=object(value);
  return {
    branches:list(data.branches).map(value=>{const b=object(value);return {id:text(b.id),code:text(b.code),name:text(b.name),isActive:boolean(b.isActive)};}),
    warehouses:list(data.warehouses).map(value=>{const w=object(value);return {id:text(w.id),code:text(w.code),name:text(w.name),
      branchId:w.branchId===null?null:text(w.branchId),isActive:boolean(w.isActive),updatedAt:text(w.updatedAt),
      hasStockOrReservations:boolean(w.hasStockOrReservations),hasMovements:boolean(w.hasMovements),hasProductAssociations:boolean(w.hasProductAssociations)};}),
  };
}
export async function fetchWarehouseAdministration():Promise<WarehouseAdministration> {
  if(!supabase)throw Error('الاتصال بقاعدة البيانات غير جاهز.');
  const {data,error}=await supabase.rpc('get_owner_warehouses_v1');
  if(error)throw Error(error.message);
  return readWarehouseAdministration(data);
}
export function warehouseSavePayload(input:SaveWarehouseInput){
  return {p_id:input.id,p_code:input.code,p_name:input.name.trim(),p_branch_id:input.branchId,
    p_is_active:input.isActive,p_expected_updated_at:input.expectedUpdatedAt};
}
export async function saveWarehouse(input:SaveWarehouseInput):Promise<void> {
  if(!supabase)throw Error('الاتصال بقاعدة البيانات غير جاهز.');
  const {error}=await supabase.rpc('save_owner_warehouse_v1',warehouseSavePayload(input));
  if(error)throw Error(error.message);
}
