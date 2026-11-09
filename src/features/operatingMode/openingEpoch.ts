import {parseJodToMinor,parseWholeNumber} from '../goLive/goLiveImport';
export interface EpochCatalogRow {productId:string;warehouseId:string;sku:string;productName:string;warehouseName:string;baseUnitName:string;previousQuantity:number}
export interface EpochRow {productId:string;warehouseId:string;actualQuantity:number;unitCostInMinorUnits:number}
export interface EpochPreview {fingerprint:string;rows:EpochRow[];totalQuantity:string;totalValueExact:string}
export const epochHeaders=['رمز الصنف','اسم الصنف','المستودع','الكمية الفعلية بالباكيت','تكلفة الباكيت بالدينار','معرف الصنف — لا تغيّر','معرف المستودع — لا تغيّر'] as const;
export const epochKey=(row:Pick<EpochRow,'productId'|'warehouseId'>)=>row.productId+':'+row.warehouseId;
export const epochRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const epochUuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v);
export const epochInvalid=()=>Error('EPOCH-01: تعذر التحقق من جرد التفعيل. راجع الملف والحالة؛ لا تبدأ محاولة جديدة إن كانت النتيجة غير محسومة.');
const integer=(v:unknown,max=2147483647):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=max;
export function canonicalEpochRows(value:unknown):EpochRow[]{
 if(!Array.isArray(value)||!value.length||value.length>10000)throw epochInvalid();const seen=new Set<string>(),costs=new Map<string,number>();
 const rows=value.map((v:unknown)=>{if(!epochRecord(v)||Object.keys(v).sort().join(',')!=='actualQuantity,productId,unitCostInMinorUnits,warehouseId'||!epochUuid(v.productId)||!epochUuid(v.warehouseId)||!integer(v.actualQuantity)||!integer(v.unitCostInMinorUnits,999999999999)||(v.actualQuantity>0&&v.unitCostInMinorUnits<=0))throw epochInvalid();
 const row={productId:v.productId.toLowerCase(),warehouseId:v.warehouseId.toLowerCase(),actualQuantity:v.actualQuantity,unitCostInMinorUnits:v.unitCostInMinorUnits},key=epochKey(row);if(seen.has(key)||(costs.has(row.productId)&&costs.get(row.productId)!==row.unitCostInMinorUnits))throw epochInvalid();seen.add(key);costs.set(row.productId,row.unitCostInMinorUnits);return row;});
 return rows.sort((a,b)=>epochKey(a).localeCompare(epochKey(b),'en'));
}
export function epochTotals(rows:readonly EpochRow[]){return {totalQuantity:rows.reduce((sum,r)=>sum+BigInt(r.actualQuantity),0n).toString(),totalValueExact:rows.reduce((sum,r)=>sum+BigInt(r.actualQuantity)*BigInt(r.unitCostInMinorUnits),0n).toString()};}
export function parseEpochCatalog(value:unknown):EpochCatalogRow[]{
 if(!epochRecord(value)||value.contractVersion!=='sales-only-epoch-catalog2-v1'||value.fullAccounting!==false||!Array.isArray(value.rows)||value.rows.length!==value.itemCount||!value.rows.length||value.rows.length>10000)throw epochInvalid();const seen=new Set<string>();
 return value.rows.map((r:unknown)=>{if(!epochRecord(r)||!epochUuid(r.productId)||!epochUuid(r.warehouseId)||!integer(r.previousQuantity)||['sku','productName','warehouseName','baseUnitName'].some(k=>typeof r[k]!=='string'||!(r[k] as string).trim()||(r[k] as string).length>1000))throw epochInvalid();const row={productId:r.productId.toLowerCase(),warehouseId:r.warehouseId.toLowerCase(),sku:r.sku as string,productName:r.productName as string,warehouseName:r.warehouseName as string,baseUnitName:r.baseUnitName as string,previousQuantity:r.previousQuantity};if(seen.has(epochKey(row)))throw epochInvalid();seen.add(epochKey(row));return row;});
}
export function epochTemplate(catalog:readonly EpochCatalogRow[]){return [[...epochHeaders],...catalog.map(r=>[r.sku,r.productName,r.warehouseName,'','',r.productId,r.warehouseId])];}
export function parseEpochSheet(sheet:readonly(readonly string[])[],catalog:readonly EpochCatalogRow[]):{rows:EpochRow[];errors:string[]}{
 const errors:string[]=[],rows:EpochRow[]=[],seen=new Set<string>(),byId=new Map(catalog.map(r=>[epochKey(r),r]));
 if(epochHeaders.some((h,i)=>sheet[0]?.[i]?.trim()!==h))return {rows:[],errors:['عناوين الملف لا تطابق قالب جرد التفعيل؛ حمّل القالب من هذه الشاشة.']};
 sheet.slice(1).forEach((cells,index)=>{if(!cells.some(c=>c.trim()))return;const source=byId.get((cells[5]??'').trim().toLowerCase()+':'+(cells[6]??'').trim().toLowerCase()),quantity=parseWholeNumber(cells[3]??''),cost=parseJodToMinor(cells[4]??'');
  if(!source||source.sku!==(cells[0]??'').trim()||source.warehouseName!==(cells[2]??'').trim()){errors.push(`الصف ${index+2}: هوية الصنف/المستودع تغيّرت؛ استخدم القالب نفسه.`);return;}
  if(seen.has(epochKey(source))){errors.push(`الصف ${index+2}: الصنف والمستودع مكرران.`);return;}seen.add(epochKey(source));
  if(quantity===null||cost===null||(quantity>0&&BigInt(cost)<=0)){errors.push(`الصف ${index+2}: اكتب الكمية الفعلية صراحةً (صفر للمعدوم) والتكلفة بثلاث خانات كحد أقصى؛ المخزون الموجب يحتاج تكلفة موجبة.`);return;}
  rows.push({productId:source.productId,warehouseId:source.warehouseId,actualQuantity:quantity,unitCostInMinorUnits:Number(cost)});
 });
 if(seen.size!==catalog.length)errors.push('الجرد يجب أن يشمل كل صنف فعّال في كل مستودع فعّال؛ لا تحذف الأسطر ذات الكمية صفر.');
 if(!errors.length){try{return {rows:canonicalEpochRows(rows),errors};}catch{errors.push('تكلفة الباكيت للصنف نفسه يجب أن تكون واحدة في جميع المستودعات.');}}
 return {rows:[],errors};
}
export function parseEpochPreview(value:unknown,rowsInput:readonly EpochRow[]):EpochPreview{
 const rows=canonicalEpochRows(rowsInput),totals=epochTotals(rows);if(!epochRecord(value)||value.contractVersion!=='sales-only-epoch2-v1'||typeof value.previewFingerprint!=='string'||!/^[a-f0-9]{64}$/u.test(value.previewFingerprint)||value.itemCount!==rows.length||!Array.isArray(value.lines)||value.lines.length!==rows.length||value.totalQuantity!==totals.totalQuantity||value.totalValueExact!==totals.totalValueExact)throw epochInvalid();
 const reported=value.lines.map((r:unknown)=>{if(!epochRecord(r)||!integer(r.previousQuantity))throw epochInvalid();return {productId:r.productId,warehouseId:r.warehouseId,actualQuantity:r.actualQuantity,unitCostInMinorUnits:r.unitCostInMinorUnits};});if(JSON.stringify(canonicalEpochRows(reported))!==JSON.stringify(rows))throw epochInvalid();return {fingerprint:value.previewFingerprint,rows,...totals};
}
