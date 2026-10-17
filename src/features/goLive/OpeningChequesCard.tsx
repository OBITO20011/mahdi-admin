import React,{useCallback,useEffect,useId,useState} from 'react';
import {Card,SectionHeader,UiButton,FormFields,MoneyText,StatusBadge} from '../../components/ui';
import {formatUiDate} from '../../components/ui/uiFormat';
import {readXlsxFirstSheet,writeXlsx,XLSX_MIME} from '../../lib/xlsx';
import {batchKey,searchCustomers,listActiveSuppliers,type PartyOption} from '../../services/supabase/goLive.service';
import {fetchOpeningCheques,previewOpeningCheques,saveOpeningCheques,type OpeningChequeRow,type OpeningChequePage,type OpeningChequePreview} from '../../services/supabase/openingCheques.service';
import {chequeStatusLabels} from '../../services/supabase/cheques.service';
import {parseJodToMinor} from './goLiveImport';
import {OPENING_CHEQUE_COLUMNS,openingChequeTemplateRows,prepareOpeningChequeSheet} from './openingChequesImport';

const field='h-11 w-full min-w-0 rounded-xl border border-nw-border bg-nw-surface px-3 text-sm text-nw-text';
const blank={direction:'incoming',status:'pending',customer:'',supplier:'',endorsed:'',bank:'',number:'',due:'',amount:'',chequeDate:'',originalDate:'',notes:''};
const message=(e:unknown)=>e instanceof Error?e.message:'تعذر تنفيذ العملية.';
const Money=({minor}:{minor:number})=><MoneyText amount={minor/1000} currency/>;

export function OpeningChequesCard({branchId,locked,onSaved}:{branchId:string|null;locked:boolean;onSaved:()=>void}){
 const id=useId();const [open,setOpen]=useState<'manual'|'excel'|null>(null),[form,setForm]=useState(blank);
 const [customers,setCustomers]=useState<PartyOption[]>([]),[suppliers,setSuppliers]=useState<PartyOption[]>([]),[search,setSearch]=useState('');
 const [page,setPage]=useState<OpeningChequePage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [preview,setPreview]=useState<{rows:OpeningChequeRow[];data:OpeningChequePreview;key:string;file:string}|null>(null),[confirmed,setConfirmed]=useState(false);
 const load=useCallback(async()=>{try{setPage(await fetchOpeningCheques());}catch(e){setError(message(e));}},[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(open!=='manual')return;let active=true;
  Promise.all([searchCustomers(search),listActiveSuppliers()]).then(([c,s])=>{if(active){setCustomers(c);setSuppliers(s);}}).catch(e=>{if(active)setError(message(e));});
  return()=>{active=false;};},[open,search]);
 const resetPreview=()=>{setPreview(null);setConfirmed(false);setNotice('');setError('');};
 const change=(name:keyof typeof blank,value:string)=>{setForm(current=>({...current,[name]:value}));resetPreview();};
 const analyse=async(rows:OpeningChequeRow[],file:string)=>{
  if(!branchId){setError('اختر الفرع الرئيسي أولاً.');return;}setBusy(true);resetPreview();
  try{
   // One authoritative preview for the complete file detects cross-batch duplicates.
   if(rows.length>500)throw Error('الدفعة بحد أقصى 500 شيك؛ قسّم الملف إلى ملفات أصغر.');
   const data=await previewOpeningCheques(branchId,rows);setPreview({rows,data,key:await batchKey('opening-cheques',crypto.randomUUID(),0,rows),file});
  }catch(e){setError(message(e));}finally{setBusy(false);}
 };
 const manual=async(event:React.FormEvent)=>{event.preventDefault();const amount=parseJodToMinor(form.amount);
  if(amount===null||amount==='0'){setError('أدخل مبلغاً موجباً بثلاث منازل كحد أقصى.');return;}
  const row:OpeningChequeRow={sourceRow:1,direction:form.direction,initial_status:form.direction==='outgoing'?'pending':form.status,
   bank_name:form.bank,cheque_number:form.number,due_date:form.due,amount_in_minor_units:amount,cheque_date:form.chequeDate,original_debt_date:form.originalDate,notes:form.notes};
  if(form.direction==='incoming'){row.customer_id=form.customer;if(form.status==='endorsed')row.endorsed_supplier_id=form.endorsed;}
  else row.supplier_id=form.supplier;
  await analyse([row],'إدخال يدوي');
 };
 const file=async(value:File)=>{setBusy(true);resetPreview();try{const prepared=prepareOpeningChequeSheet(await readXlsxFirstSheet(await value.arrayBuffer()));
   if(prepared.errors.length){setError(prepared.errors.map(e=>`السطر ${e.row}: ${e.message}`).join(' '));return;}
   await analyse(prepared.rows,value.name);
  }catch(e){setError(message(e));}finally{setBusy(false);}};
 const save=async()=>{if(!preview||!branchId||!confirmed||preview.data.errors.length)return;setBusy(true);setError('');
  try{const result=await saveOpeningCheques(branchId,preview.key,preview.rows);setNotice(`تم الحفظ للمتابعة فقط؛ العدد: ${result.created}. لم يتغير أي رصيد.`);
   setPreview(null);setConfirmed(false);setForm(blank);await load();onSaved();
  }catch(e){setError(message(e)+' يمكنك إعادة الحفظ بنفس المعاينة بأمان.');}finally{setBusy(false);}};
 const template=()=>{const bytes=writeXlsx([{name:'البيانات',rows:openingChequeTemplateRows(),widths:OPENING_CHEQUE_COLUMNS.map(()=>24)},
  {name:'تعليمات',rows:[['أدخل الأرصدة صافية بعد الشيكات.'],['الشيك هنا للمتابعة فقط، ولا يسدد رصيداً عند إدخاله.'],['احذف سطر المثال. الأطراف يجب أن تكون موجودة وفريدة.'],['التاريخ الأصلي أولاً، ثم تاريخ الشيك إن لم يعرف؛ اتركهما فارغين للعمر غير المتاح.']],widths:[100]}]);
  const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:XLSX_MIME})),link=document.createElement('a');link.href=url;link.download='go-live-opening-cheques.xlsx';link.click();URL.revokeObjectURL(url);};
 const more=async()=>{if(!page?.hasMore)return;setBusy(true);try{const next=await fetchOpeningCheques(page.page+1);setPage({...next,entries:[...page.entries,...next.entries]});}catch(e){setError(message(e));}finally{setBusy(false);}};
 const disabled=locked||busy||!branchId;
 const input=(name:keyof typeof blank,label:string,type='text',required=false)=><label className="block min-w-0 space-y-1 text-sm">{label}<input className={field} type={type} value={form[name]} required={required} disabled={disabled} onChange={e=>change(name,e.target.value)} maxLength={name==='notes'?500:undefined} inputMode={name==='amount'?'decimal':undefined}/></label>;
 const select=(name:'customer'|'supplier'|'endorsed',label:string,options:PartyOption[])=><label className="block min-w-0 space-y-1 text-sm">{label}<select className={field} value={form[name]} required disabled={disabled} onChange={e=>change(name,e.target.value)}><option value="">اختر الطرف</option>{options.map(p=><option key={p.id} value={p.id}>{p.name}{p.detail?` · ${p.detail}`:''}</option>)}</select></label>;
 return <Card data-testid="go-live-card-cheques" className="min-w-0">
  <SectionHeader title="شيكات قائمة" hint="الأرصدة المدخلة صافية بعد خصم الشيكات؛ تسجيل الشيك هنا للمتابعة فقط ولا يغيّر أي رصيد."/>
  {!branchId&&!locked&&<p className="text-sm text-nw-warn">اختر الفرع الرئيسي أعلاه قبل إدخال الشيكات.</p>}
  {locked&&<p className="text-sm text-nw-muted">الإدخال مقفل بإنهاء بداية التشغيل. متابعة الشيكات من صفحة الشيكات.</p>}
  {page&&<div className="my-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3"><p className="m-0">وارد قيد الانتظار: <Money minor={page.incoming}/></p><p className="m-0">صادر قيد الانتظار: <Money minor={page.outgoing}/></p><p className="m-0">مجيّر: <Money minor={page.endorsed}/></p></div>}
  <div className="mt-3 flex flex-wrap gap-2"><UiButton disabled={disabled} onClick={()=>{setOpen(open==='manual'?null:'manual');resetPreview();}}>إدخال يدوي</UiButton><UiButton disabled={disabled} onClick={()=>{setOpen(open==='excel'?null:'excel');resetPreview();}}>استيراد من Excel</UiButton></div>
  {open==='manual'&&<form className="mt-3 space-y-3" onSubmit={e=>void manual(e)} data-testid="go-live-cheques-manual"><FormFields className="grid grid-cols-1 gap-3 sm:grid-cols-2">
   <label className="block space-y-1 text-sm">الاتجاه<select className={field} disabled={disabled} value={form.direction} onChange={e=>{change('direction',e.target.value);change('status','pending');}}><option value="incoming">وارد من عميل</option><option value="outgoing">صادر لمورد</option></select></label>
   {form.direction==='incoming'&&<label className="block space-y-1 text-sm">الحالة<select className={field} disabled={disabled} value={form.status} onChange={e=>change('status',e.target.value)}><option value="pending">قيد الانتظار</option><option value="endorsed">مجيّر لمورد</option></select></label>}
   {form.direction==='incoming'?<><label className="block space-y-1 text-sm">بحث العميل<input className={field} value={search} disabled={disabled} onChange={e=>{setSearch(e.target.value);change('customer','');}}/></label>{select('customer','العميل',customers)}</>:select('supplier','المورد',suppliers)}
   {form.direction==='incoming'&&form.status==='endorsed'&&select('endorsed','المورد المجيّر له',suppliers)}
   {input('bank','البنك','text',true)}{input('number','رقم الشيك','text',true)}{input('due','تاريخ الاستحقاق','date',true)}{input('amount','المبلغ (د.أ)','text',true)}
   {input('chequeDate','تاريخ الشيك (اختياري)','date')}{input('originalDate','تاريخ الدين الأصلي إن عُرف (اختياري)','date')}{input('notes','ملاحظة')}
  </FormFields><UiButton type="submit" disabled={disabled}>معاينة قبل الحفظ</UiButton></form>}
  {open==='excel'&&<div className="mt-3 space-y-3" data-testid="go-live-cheques-excel"><p className="text-sm text-nw-muted">بحد أقصى 500 سطر للملف. لا تُنشأ أطراف جديدة تلقائياً. المبلغ في الملف بالدينار، وتُحفظ الأرقام كنص.</p><UiButton onClick={template}>تنزيل القالب</UiButton><label htmlFor={id} className="flex min-h-11 cursor-pointer items-center rounded-xl border border-nw-border p-3 text-sm">اختيار ملف Excel</label><input id={id} type="file" accept=".xlsx" className="sr-only" disabled={disabled} onChange={e=>{const value=e.target.files?.[0];if(value)void file(value);}}/></div>}
  {preview&&<div className="mt-3 space-y-3 rounded-xl border border-nw-border bg-nw-surface-2 p-3" data-testid="go-live-cheques-preview"><p className="m-0 text-sm font-semibold">معاينة {preview.file} — عدد الشيكات: {preview.data.rowCount}</p>
   {preview.data.errors.length>0&&<ul className="m-0 space-y-1 ps-5 text-sm text-nw-bad">{preview.data.errors.map((e,i)=><li key={`${e.row}-${i}`}>السطر {e.row}: {e.message}</li>)}</ul>}
   {preview.data.parties.map(p=><div key={`${p.kind}-${p.id}`} className="text-sm"><p className="m-0 font-semibold">{p.name} — {p.kind==='customer'?'عميل':'مورد'}</p><p className="m-0">الرصيد المُدخل <Money minor={p.entered}/> + شيكات قائمة <Money minor={p.cheques}/> = <Money minor={p.beforeCheques}/> قبل الشيكات</p></div>)}
   <p className="text-sm text-nw-muted">العمر من تاريخ الدين الأصلي، أو تاريخ الشيك عند غيابه، وإلا «عمر غير متاح». لن تُسجل دفعة أو حركة درج.</p>
   <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={disabled||preview.data.errors.length>0} onChange={e=>setConfirmed(e.target.checked)}/>راجعت الرصيد الصافي ومعاينة الشيكات مع الدفتر</label>
   <UiButton variant="accent" disabled={disabled||!confirmed||preview.data.errors.length>0} onClick={()=>void save()}>حفظ الشيكات للمتابعة فقط</UiButton>
  </div>}
  {error&&<p role="alert" className="text-sm text-nw-bad">{error}</p>}{notice&&<p role="status" className="text-sm text-nw-ok">{notice}</p>}{busy&&<p role="status" className="text-sm text-nw-muted">جارٍ التحقق…</p>}
  {page&&page.entries.length>0&&<ul className="mt-3 list-none space-y-2 p-0" aria-label="الشيكات الافتتاحية المسجلة">{page.entries.map(c=><li key={c.id} className="min-w-0 rounded-xl border border-nw-border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="break-words">{c.bank} · <bdi dir="ltr">{c.number}</bdi></span><StatusBadge tone={c.status==='returned'?'bad':c.status==='cleared'?'ok':'warn'}>{chequeStatusLabels[c.status]}</StatusBadge></div><p className="m-0 mt-1">{c.customerName||c.supplierName}{c.endorsedSupplierName?` ← ${c.endorsedSupplierName}`:''}</p><p className="m-0 mt-1"><Money minor={c.amount}/> · الاستحقاق {formatUiDate(c.dueDate,{year:'numeric',month:'2-digit',day:'2-digit'})}</p></li>)}</ul>}
  {page?.hasMore&&<UiButton disabled={busy} onClick={()=>void more()}>تحميل المزيد</UiButton>}
 </Card>;
}
