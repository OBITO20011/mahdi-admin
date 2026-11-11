import {parseDate,parseJodToMinor,type RowError,type ImportOperatingMode} from './goLiveImport';
import {IMPORT_DESCRIPTIVE_KEYS,normalizeImportDisplayText} from './importDisplayText';
import type {OpeningChequeRow} from '../../services/supabase/openingCheques.service';

export const OPENING_CHEQUE_COLUMNS=[
 ['direction','الاتجاه (وارد/صادر)'],['initial_status','الحالة (قيد الانتظار/مجيّر)'],['bank_name','البنك'],['cheque_number','رقم الشيك'],
 ['due_date','تاريخ الاستحقاق'],['amount','المبلغ (د.أ)'],['customer_name','اسم العميل'],['customer_phone','هاتف العميل'],
 ['supplier_name','اسم المورد للصادر'],['endorsed_supplier_name','المورد المجيّر له'],['cheque_date','تاريخ الشيك (اختياري)'],
 ['original_debt_date','تاريخ الدين الأصلي (اختياري)'],['notes','ملاحظة'],
] as const;
export const openingChequeTemplateRows=()=>[OPENING_CHEQUE_COLUMNS.map(c=>c[1]),
 ['وارد','قيد الانتظار','بنك المثال','000123','2026-12-01','100.000','اسم العميل الموجود','0790000000','','','2026-10-01','','احذف سطر المثال']];

export function prepareOpeningChequeSheet(sheet:readonly (readonly string[])[],mode:ImportOperatingMode='full'):{rows:OpeningChequeRow[];errors:RowError[];normalizedFields:number}{
 const header=sheet[0]?.map(c=>c.trim())??[];
 if(header.length!==OPENING_CHEQUE_COLUMNS.length||header.some((name,i)=>name!==OPENING_CHEQUE_COLUMNS[i][1]))
  return {rows:[],errors:[{row:1,message:'استخدم القالب دون تغيير عناوين الأعمدة أو ترتيبها.'}],normalizedFields:0};
 const rows:OpeningChequeRow[]=[],errors:RowError[]=[];
 let normalizedFields=0;
 for(let i=1;i<sheet.length;i++){
  const cells=sheet[i];if(cells.every(c=>!c.trim()))continue;
  if(cells.length>header.length&&cells.slice(header.length).some(c=>c.trim())){errors.push({row:i+1,message:'أعمدة إضافية غير معتمدة.'});continue;}
  const row:OpeningChequeRow={sourceRow:i+1};for(let n=0;n<OPENING_CHEQUE_COLUMNS.length;n++)row[OPENING_CHEQUE_COLUMNS[n][0]]=(cells[n]??'').trim();
  for(const key of IMPORT_DESCRIPTIVE_KEYS)if(typeof row[key]==='string'){const raw=String(row[key]),value=normalizeImportDisplayText(raw);row[key]=value;if(raw!==value)normalizedFields++;}
  row.direction=row.direction==='وارد'?'incoming':row.direction==='صادر'?'outgoing':row.direction;
  row.initial_status=row.initial_status==='قيد الانتظار'?'pending':['مجيّر','مُجيّر','مجير'].includes(String(row.initial_status))?'endorsed':row.initial_status;
  if(mode==='sales-only'&&(row.direction!=='incoming'||row.initial_status!=='pending'))errors.push({row:i+1,message:'وضع المبيعات والذمم يقبل شيك عميل وارد قيد الانتظار فقط؛ الموردون والتجيير مطفآن.'});
  const minor=parseJodToMinor(String(row.amount));delete row.amount;
  if(minor===null||minor==='0')errors.push({row:i+1,message:'المبلغ موجب وبثلاث منازل كحد أقصى.'});else row.amount_in_minor_units=minor;
  for(const name of ['due_date','cheque_date','original_debt_date']){
   const raw=String(row[name]??'');if(!raw&&name!=='due_date')continue;const date=parseDate(raw);
   if(!date)errors.push({row:i+1,message:`تاريخ غير صالح: ${OPENING_CHEQUE_COLUMNS.find(c=>c[0]===name)?.[1]??name}`});else row[name]=date;
  }
  rows.push(row);
 }
 if(!rows.length&&!errors.length)errors.push({row:1,message:'الملف لا يحتوي أسطراً.'});
 return {rows,errors,normalizedFields};
}
