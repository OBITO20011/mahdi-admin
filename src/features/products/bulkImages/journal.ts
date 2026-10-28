export type ImageJournalStage='prepared'|'uploaded'|'uncertain'|'cleanup_pending'|'confirmed';
export interface ImageJournalEntry{productId:string;fingerprint:string;sku:string;fileName:string;publicUrl:string;storagePath:string;previousImageUrl:string;stage:ImageJournalStage;at:number}
export interface ImageJournal{get(productId:string,fingerprint:string):ImageJournalEntry|undefined;all():ImageJournalEntry[];put(entry:ImageJournalEntry):void;remove(productId:string,fingerprint:string):void}
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu;
const hash=/^[a-f\d]{64}$/u;
const key=(id:string,digest:string)=>id+':'+digest;

/** No image bytes,Auth credentials or tokens. An atomic write precedes Storage. */
export function createImageJournal(storage:Pick<Storage,'getItem'|'setItem'>,origin:string,userId:string):ImageJournal{
 if(!uuid.test(userId))throw new Error('تعذر تحديد حساب رفع الصور.');
 const base=origin.replace(/\/+$/u,''),scope=base+'|'+userId,storageKey='nawasrah-bulk-images-v1:'+scope;
 const validate=(entry:ImageJournalEntry)=>{
  const filename=entry.storagePath?.slice(userId.length+1);
  return uuid.test(entry.productId)&&hash.test(entry.fingerprint)&&entry.storagePath?.startsWith(userId+'/')
   &&typeof filename==='string'&&/^[a-f\d-]{36}\.(jpg|png|webp)$/iu.test(filename)
   &&entry.publicUrl===base+'/storage/v1/object/public/product-images/'+entry.storagePath
   &&['prepared','uploaded','uncertain','cleanup_pending','confirmed'].includes(entry.stage)
   &&typeof entry.previousImageUrl==='string'&&typeof entry.sku==='string'&&typeof entry.fileName==='string'&&Number.isFinite(entry.at);
 };
 let entries:Record<string,ImageJournalEntry>={};
 try{const raw=storage.getItem(storageKey);if(raw){const parsed=JSON.parse(raw) as {version:number;scope:string;entries:ImageJournalEntry[]};
  if(parsed.version!==1||parsed.scope!==scope||!Array.isArray(parsed.entries)||!parsed.entries.every(validate))throw new Error('INVALID_JOURNAL');
  entries=Object.fromEntries(parsed.entries.map(entry=>[key(entry.productId,entry.fingerprint),entry]));
 }}catch{throw new Error('تعذرت قراءة سجل رفع الصور السابق. لا تحذفه؛ تواصل مع المطوّر لفحص الاستئناف.');}
 const persist=(next:Record<string,ImageJournalEntry>)=>{
  const values=Object.values(next).sort((a,b)=>a.at-b.at);
  while(values.length>2000){const index=values.findIndex(e=>e.stage==='confirmed');if(index<0)throw new Error('نظّف عمليات رفع الصور السابقة قبل إضافة دفعة أخرى.');const [removed]=values.splice(index,1);delete next[key(removed.productId,removed.fingerprint)];}
  try{storage.setItem(storageKey,JSON.stringify({version:1,scope,entries:values}));}catch{throw new Error('تعذر حفظ سجل الاستئناف على هذا الجهاز. أفرغ مساحة قبل رفع الصور.');}
  entries=next;
 };
 return {get:(id,digest)=>entries[key(id,digest)],all:()=>Object.values(entries),
  put:entry=>{if(!validate(entry))throw new Error('بيانات استئناف الصورة غير صالحة.');persist({...entries,[key(entry.productId,entry.fingerprint)]:entry});},
  remove:(id,digest)=>{const next={...entries};delete next[key(id,digest)];persist(next);}};
}
