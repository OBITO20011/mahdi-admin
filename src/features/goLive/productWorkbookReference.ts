import {skuKey,type ProductWorkbookPlan,type WorkbookIssue} from './productWorkbook';
export interface ProductWorkbookReference {categories:{id?:string;name:string;active:boolean}[];units:{id?:string;code:string;name:string}[];brands?:{id?:string;name:string;active:boolean}[];warehouses?:{id?:string;code:string;name?:string;active:boolean}[];products:{id?:string;sku:string;barcode:string}[]}
export function validateProductWorkbookReference(plan:ProductWorkbookPlan,ref:ProductWorkbookReference):WorkbookIssue[]{
 const errors:WorkbookIssue[]=[];
 for(const row of plan.products){const add=(message:string)=>errors.push({row:row.row,message});
  if(ref.categories.filter(c=>c.active&&c.name===row.data.category_name).length!==1)add('القسم غير موجود أو غير نشط أو اسمه مكرر؛ صحح المرجع أولاً.');
  for(const key of ['base_unit_name','purchase_unit_name','sale_unit_name']as const){const value=row.data[key];const byCode=ref.units.filter(u=>skuKey(u.code)===skuKey(value));if((byCode.length?byCode:ref.units.filter(u=>u.name===value)).length!==1)add('الوحدة غير معرّفة أو اسمها مكرر؛ استخدم رمزها الصحيح مثل PKT/CTN.');}
  if(row.brand&&ref.brands?.filter(b=>b.active&&b.name===row.brand).length!==1)add('العلامة التجارية غير معرّفة أو مرجع العلامات غير متاح.');
  if(row.warehouse&&ref.warehouses?.filter(w=>w.active&&skuKey(w.code)===skuKey(row.warehouse)).length!==1)add('رمز المستودع غير معرّف أو مرجع المستودعات غير متاح.');
  for(const item of [{sku:row.data.sku,barcode:row.data.barcode,row:row.row,sheet:'المنتجات' as const},...row.flavors.map(f=>({...f,sheet:'النكهات' as const}))])for(const code of [item.sku,item.barcode].filter(Boolean))if(ref.products.some(p=>[p.sku,p.barcode].filter(Boolean).some(c=>skuKey(c)===skuKey(code))))errors.push({row:item.row,sheet:item.sheet,message:'الرمز أو الباركود مستخدم لمنتج موجود؛ لا تُعد استيراده كمنتج جديد.'});
 }
 return errors;
}
