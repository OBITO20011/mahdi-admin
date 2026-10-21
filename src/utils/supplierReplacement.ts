export type SupplierReplacementAction = 'shop_pending'|'shop_immediate'|'shop_damage'|'receive'|'writeoff'|'reverse'|'customer_return';
export type SupplierReplacementPayload = Record<string,unknown>;
export interface SupplierReplacementEvent {
  id:string;action:'send'|'immediate'|'receive'|'writeoff'|'damage'|'reverse';quantity:number;heldDelta:number;
  occurredAt:string;isReversed:boolean;reversesEventId:string|null;reason?:string;
}
export interface SupplierReplacementCase {
  id:string;supplierId:string|null;supplierName:string|null;productId:string;productName:string;warehouseId:string;branchId:string;
  origin:'shop'|'customer_return'|'shop_damage';quantity:number;commercialQuantity:number;unitsPerCommercialUnit:number;
  unitName:string;baseUnitName:string;pendingQuantity:number;receivedQuantity:number;writtenOffQuantity:number;occurredAt:string;
  events:SupplierReplacementEvent[];unitCostInMinorUnitsExact?:string;pendingValueInMinorUnitsExact?:string;
}
export interface SupplierReplacementPage {
  contractVersion:208;page:number;pageSize:number;totalCount:number;pendingQuantity:number;
  pendingValueInMinorUnitsExact?:string;cases:SupplierReplacementCase[];
}
export const replacementRecord=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>new Error('دليل استبدال المورد غير مكتمل. أعد التحميل أو استعد نفس المحاولة.');
const string=(v:unknown):string=>{if(typeof v!=='string'||!v)throw invalid();return v;};
const nullableString=(v:unknown)=>v===null?null:string(v);
const integer=(v:unknown,min=0):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min)throw invalid();return v;};
export function exactReplacementAmount(v:unknown):string {
  if(typeof v!=='string'||!/^\d+(?:\.\d{1,6})?$/u.test(v))throw invalid();return v;
}
export function readReplacementCase(v:unknown):SupplierReplacementCase {
  if(!replacementRecord(v)||!['shop','customer_return','shop_damage'].includes(String(v.origin))||!Array.isArray(v.events))throw invalid();
  const hasValues=v.unitCostInMinorUnitsExact!==undefined;
  if(hasValues!==(v.pendingValueInMinorUnitsExact!==undefined))throw invalid();
  const result:SupplierReplacementCase={id:string(v.id),supplierId:nullableString(v.supplierId),supplierName:nullableString(v.supplierName),
    productId:string(v.productId),productName:string(v.productName),warehouseId:string(v.warehouseId),branchId:string(v.branchId),
    origin:v.origin as SupplierReplacementCase['origin'],quantity:integer(v.quantity,1),commercialQuantity:integer(v.commercialQuantity,1),
    unitsPerCommercialUnit:integer(v.unitsPerCommercialUnit,1),unitName:string(v.unitName),baseUnitName:string(v.baseUnitName),
    pendingQuantity:integer(v.pendingQuantity),receivedQuantity:integer(v.receivedQuantity),writtenOffQuantity:integer(v.writtenOffQuantity),occurredAt:string(v.occurredAt),
    events:v.events.map(e=>{
      if(!replacementRecord(e)||!['send','immediate','receive','writeoff','damage','reverse'].includes(String(e.action))||typeof e.isReversed!=='boolean')throw invalid();
      return {id:string(e.id),action:e.action as SupplierReplacementEvent['action'],quantity:integer(e.quantity,1),heldDelta:integer(e.heldDelta,-2147483647),
        occurredAt:string(e.occurredAt),reversesEventId:nullableString(e.reversesEventId),isReversed:e.isReversed,...(e.reason===undefined?{}:{reason:string(e.reason)})};
    }),...(hasValues?{unitCostInMinorUnitsExact:exactReplacementAmount(v.unitCostInMinorUnitsExact),pendingValueInMinorUnitsExact:exactReplacementAmount(v.pendingValueInMinorUnitsExact)}:{})};
  if(result.quantity!==result.commercialQuantity*result.unitsPerCommercialUnit||result.pendingQuantity>result.quantity)throw invalid();
  return result;
}
export function readReplacementPage(v:unknown):SupplierReplacementPage {
  if(!replacementRecord(v)||v.contractVersion!==208||!Array.isArray(v.cases))throw invalid();
  return {contractVersion:208,page:integer(v.page,1),pageSize:integer(v.pageSize,1),totalCount:integer(v.totalCount),pendingQuantity:integer(v.pendingQuantity),
    cases:v.cases.map(readReplacementCase),...(v.pendingValueInMinorUnitsExact===undefined?{}:{pendingValueInMinorUnitsExact:exactReplacementAmount(v.pendingValueInMinorUnitsExact)})};
}
export function readReplacementResult(v:unknown,action:SupplierReplacementAction,key:string) {
  if(!replacementRecord(v)||v.success!==true||v.contractVersion!==208||v.action!==action||v.idempotencyKey!==key||typeof v.idempotent!=='boolean'||!Array.isArray(v.cases)||!v.cases.length)throw invalid();
  if(action==='customer_return'&&(!replacementRecord(v.returnResult)||v.returnResult.success!==true))throw invalid();
  return {operationId:string(v.operationId),recovered:v.idempotent,cases:v.cases.map(readReplacementCase),
    ...(action==='customer_return'?{returnResult:v.returnResult as Record<string,unknown>}:{})};
}
export const supplierReplacementRoles=['owner','manager','warehouse_keeper'] as const;
export function replacementMoney(exact:string):number {
  const value=Number(exact);if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)throw new Error('قيمة المعلّق خارج نطاق العرض الآمن.');return value/1000;
}
export const canUseSupplierReplacement=(roles:readonly string[],role?:string|null)=>[...roles,role].some(r=>supplierReplacementRoles.some(allowed=>allowed===r));
