/** Receipt presentation uses saved commercial evidence only. No catalogue, prices or writes. */
import {SINGLE_SALE_UNIT,savedSaleUnitLabel} from '../utils/saleUnitLabels';
export interface ReceiptComponent {name:string;quantity:number;unitName:string}
export interface ReceiptParcel {components:ReceiptComponent[]}
export interface CommercialReceiptLine {
  key:string;name:string;kind?:string;quantity:number;baseQuantity?:number;
  baseUnitName?:string;savedUnitName?:string;parcels?:ReceiptParcel[];
  totalInMinorUnits:number;
}
export interface ReceiptDocumentData {
  businessName:string;number:string;createdAt:string;customerName?:string;
  branch:{name:string;address?:string;phone?:string};lines:CommercialReceiptLine[];
  subtotalInMinorUnits:number;discountInMinorUnits:number;deliveryInMinorUnits:number;
  totalInMinorUnits:number;paymentLabel:string;remainingInMinorUnits?:number;changeInMinorUnits?:number;
}
const count=(value:number)=>Number.isSafeInteger(value)&&value>=0?String(value):'غير متاح';
export const receiptMoney=(minor:number)=>`${(minor/1000).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3,useGrouping:false})} د.أ`;
function componentName(parent:string,name:string){
  const saved=name.trim();
  for(const separator of [' - ',' — ',' – ']){
    const prefix=parent.trim()+separator;
    if(saved.startsWith(prefix)&&saved.slice(prefix.length).trim())return saved.slice(prefix.length).trim();
  }
  return saved||'اسم النكهة غير متاح';
}
export function receiptLineDescription(line:CommercialReceiptLine):string {
  const quantity=count(line.quantity),unit=SINGLE_SALE_UNIT;
  if(line.kind==='legacy_single_sku_parcel')return `${quantity} طرد (${line.baseQuantity===undefined?'المحتوى المحفوظ غير متاح':`${count(line.baseQuantity)} ${unit}`})`;
  if(line.kind==='base_unit')return `${quantity} ${unit}`;
  if(line.kind==='configurable_parcel'){
    if(!line.parcels?.length||line.parcels.length!==line.quantity||line.parcels.some(p=>!p.components.length))return `${quantity} طرد مشكّل (المكونات المحفوظة غير متاحة)`;
    const recipes=line.parcels.map(p=>p.components.map(c=>`${count(c.quantity)} ${componentName(line.name,c.name)}`).join(' + '));
    const composition=recipes.every(r=>r===recipes[0])?recipes[0]:recipes.map((r,index)=>`الطرد ${index+1}: ${r}`).join('؛ ');
    return `${quantity} طرد مشكّل (${composition})`;
  }
  // Historical fields remain unchanged;only the saved unit label is displayed
  // canonically. Never infer a commercial kind or multiply a quantity from N.
  return `${quantity} ${savedSaleUnitLabel(line.savedUnitName)}`;
}
export function receiptDocumentShareText(receipt:ReceiptDocumentData,url?:string):string {
  return [receipt.businessName,receipt.branch.name,`إيصال البيع رقم: ${receipt.number}`,
    receipt.createdAt?`التاريخ: ${new Date(receipt.createdAt).toLocaleString('ar-JO-u-nu-latn')}`:'',
    receipt.customerName?`العميل: ${receipt.customerName}`:'',
    ...receipt.lines.map(line=>`• ${line.name}: ${receiptLineDescription(line)} - ${receiptMoney(line.totalInMinorUnits)}`),
    `المجموع الفرعي: ${receiptMoney(receipt.subtotalInMinorUnits)}`,
    receipt.discountInMinorUnits>0?`الخصم: ${receiptMoney(receipt.discountInMinorUnits)}`:'',
    receipt.deliveryInMinorUnits>0?`التوصيل: ${receiptMoney(receipt.deliveryInMinorUnits)}`:'',
    `الإجمالي: ${receiptMoney(receipt.totalInMinorUnits)}`,`طريقة الدفع: ${receipt.paymentLabel}`,
    (receipt.remainingInMinorUnits??0)>0?`المتبقي على العميل: ${receiptMoney(receipt.remainingInMinorUnits!)}`:'',
    (receipt.changeInMinorUnits??0)>0?`الباقي للعميل: ${receiptMoney(receipt.changeInMinorUnits!)}`:'',
    url?`رابط الإيصال الإلكتروني: ${url}`:''].filter(Boolean).join('\n');
}
