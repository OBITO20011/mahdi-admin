/** Post-create barcode phase only; underlying family creation/permissions stay unchanged. */
import{isSupabaseConfigured,supabase,sanitizedSupabaseUrl}from'../../lib/supabase';
import{readProductImportSnapshot,productImportContext}from'./productWorkbook.service';
interface Item {name:string;barcode:string;id?:string}
interface Attempt {version:1;actor:string;project:string;familyId:string;items:Item[]}
const prefix=(actor:string)=>'nawasrah:family-barcodes:v1:'+actor+':'+sanitizedSupabaseUrl+':';
function validate(value:unknown,actor:string):Attempt{
 const a=value as Attempt;if(!a||a.version!==1||a.actor!==actor||a.project!==sanitizedSupabaseUrl||!/^[a-f0-9-]{36}$/u.test(a.familyId)||!Array.isArray(a.items)||!a.items.length||a.items.some(i=>!i||typeof i.name!=='string'||typeof i.barcode!=='string'||(i.id!==undefined&&!/^[a-f0-9-]{36}$/u.test(i.id))))throw Error('تعذر قراءة سجل باركود النكهات؛ توقف وراجع المطوّر (FLV-01).');return a;
}
export function pendingFamilyBarcodes(actor:string,storage:Storage):string[]{const result:string[]=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix(actor))){let raw:unknown;try{raw=JSON.parse(storage.getItem(key)!);}catch{throw Error('تعذر قراءة سجل باركود النكهات (FLV-01).');}result.push(validate(raw,actor).familyId);}}return result;}
export async function completeFamilyBarcodes(actor:string,familyId:string,storage:Storage,items?:readonly{name:string;barcode:string}[]){
 await productImportContext(actor);if(!isSupabaseConfigured||!supabase)throw Error('تعذر الاتصال؛ استكمل باركود العائلة المحفوظة (FLV-02).');
 const key=prefix(actor)+familyId;let attempt:Attempt;
 if(storage.getItem(key)!==null){attempt=validate(JSON.parse(storage.getItem(key)!),actor);if(items&&JSON.stringify(attempt.items.map(({name,barcode})=>({name,barcode})))!==JSON.stringify(items))throw Error('تختلف النكهات عن المحاولة المحفوظة؛ استكمل المحاولة الأصلية (FLV-03).');}
 else{if(!items?.length)throw Error('سجل استكمال باركود العائلة غير موجود (FLV-01).');attempt={version:1,actor,project:sanitizedSupabaseUrl,familyId,items:items.map(i=>({...i}))};}
 const save=()=>{const text=JSON.stringify(attempt);storage.setItem(key,text);if(storage.getItem(key)!==text)throw Error('تعذر حفظ سجل استكمال باركود النكهات؛ لا تنشئ العائلة مرة أخرى (FLV-04).');};
 save();let snapshot=await readProductImportSnapshot(familyId);
 if(snapshot.flavors.length!==attempt.items.length)throw Error('تغيّرت نكهات العائلة؛ راجع المطوّر قبل الاستكمال (FLV-03).');
 for(const item of attempt.items){const rows=snapshot.flavors.filter(f=>f.name===item.name);if(rows.length!==1||(item.id&&item.id!==rows[0].id))throw Error('هوية النكهة لا تطابق المحاولة المحفوظة (FLV-03).');item.id=rows[0].id;}
 save();
 for(const item of attempt.items){if(!item.barcode)continue;const c=snapshot.flavors.find(f=>f.id===item.id)!;
  if(c.barcode===item.barcode)continue;if(c.barcode)throw Error('تغيّر باركود النكهة؛ لا نستبدله تلقائياً (FLV-03).');
  const response=await supabase.rpc('update_product_flavor_v2',{p_flavor_product_id:c.id,p_expected_updated_at:c.metadata!.updated_at,p_flavor_name_ar:c.name,p_barcode:item.barcode,p_image_url:null,p_is_active:c.metadata!.is_active});
  if(response.error||response.data?.success!==true)throw Error('حُفظت العائلة، ولم نتأكد من اكتمال باركودها. استكمل المحاولة؛ لا تنشئها من جديد (FLV-02).');
 }
 snapshot=await readProductImportSnapshot(familyId);for(const item of attempt.items)if(snapshot.flavors.find(f=>f.id===item.id)?.barcode!==item.barcode)throw Error('لم تتطابق قراءة باركود النكهة؛ أبقِ سجل المحاولة (FLV-03).');
 storage.removeItem(key);return{complete:true,familyId};
}

export function familyBarcodeErrorText(error:unknown){
 const code=error instanceof Error?error.message.match(/FLV-0[1-4]/u)?.[0]:undefined;
 if(code==='FLV-04')return 'تعذر حفظ سجل الاستكمال. لا تغلق النافذة؛ أصلح مساحة التخزين ثم أعد الاستكمال (FLV-04).';
 if(code==='FLV-03')return 'تغيّرت هوية النكهة أو باركودها. لا تنشئها مرة أخرى؛ راجع المطوّر (FLV-03).';
 return 'حُفظت العائلة، ولم نتأكد من اكتمال الباركود. استكمل المحاولة نفسها؛ لا تنشئ عائلة جديدة (FLV-02).';
}
