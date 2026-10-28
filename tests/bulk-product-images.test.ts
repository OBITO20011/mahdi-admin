import assert from 'node:assert/strict';
import test from 'node:test';
import {activeProductsMissingImages,canUploadProductImages,imageFileSku,matchProductImages,normalizeImageSku,type BulkImageAuth,type BulkImageRow} from '../src/features/products/bulkImages/model';
import {createImageJournal,type ImageJournalEntry} from '../src/features/products/bulkImages/journal';
import {reconcileImage,runBulkImageUpload,type BulkImageDependencies} from '../src/features/products/bulkImages/upload';
import type {Product} from '../src/types';

const id=(n:number)=>'11000000-0000-4000-8000-'+String(n).padStart(12,'0'),origin='http://127.0.0.1:54321',owner=id(1),fingerprint='a'.repeat(64);
const product=(n:number,sku:string,extra:Partial<Product>={}):Product=>({id:id(n),sku,barcode:'',nameAr:'صنف وهمي '+sku,imageUrl:'',categoryId:id(2),costPrice:1,retailPrice:2,wholesalePrice:2,taxRate:0,unit:'باكيت',onHandQuantity:10,reservedQuantity:0,availableQuantity:10,reorderLevel:0,status:'active',createdAt:'2026-01-01',updatedAt:'2026-01-01',...extra});
const file=(name:string)=>new File(['fixture'],name,{type:name.endsWith('.png')?'image/png':'image/jpeg'});
const memory=()=>{const map=new Map<string,string>();return {getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},map};};
function fixture(products:Product[]){
 const storage=memory(),journal=createImageJournal(storage,origin,owner),catalog=new Map(products.map(p=>[p.id,{...p}])),stored=new Set<string>(),references=new Set<string>(),removed:string[]=[],uploads:string[]=[];
 let nextPath=100;
 const deps:BulkImageDependencies={journal,canEdit:()=>true,readProduct:async key=>{const p=catalog.get(key);return p?{...p}:null;},hasReference:async entry=>references.has(entry.publicUrl),
  upload:async(_file,before,resumePath)=>{const path=resumePath??owner+'/'+id(nextPath++)+'.jpg',publicUrl=origin+'/storage/v1/object/public/product-images/'+path;before({storagePath:path,publicUrl});uploads.push(path);stored.add(path);return {success:true,storagePath:path,publicUrl};},
  save:async(p,url)=>{catalog.set(p.id,{...p,imageUrl:url});references.add(url);return {success:true};},
  remove:async path=>{stored.delete(path);removed.push(path);return true;}};
 const rows=(chosen:Product[]=products):BulkImageRow[]=>chosen.map((p,i)=>({key:p.id,match:matchProductImages([file(p.sku+'.jpg')],chosen)[0],replace:false,outcome:'pending',prepared:{file:file(p.sku+'.jpg'),fingerprint:(i+1).toString(16).padStart(64,'0'),thumbnail:new Blob(),width:10,height:10}}));
 return {deps,rows,catalog,stored,references,removed,uploads,storage,journal};
}

test('SKU matching trims,folds case and both Arabic digit sets;never matches the product name',()=>{
 assert.equal(normalizeImageSku(' sug-١۰ '),'SUG-10');assert.equal(imageFileSku(' sug-١٠ .JPG'),'SUG-10');
 const catalog=[product(10,'SUG-10'),product(11,'PRG-BBQ',{flavorMasterProductId:id(12),flavorNameAr:'حار'})];
 const rows=matchProductImages([file('sug-۱۰.jpg'),file('prg-bbq.png'),file(catalog[0].nameAr+'.jpg'),file('missing.webp')],catalog);
 assert.deepEqual(rows.map(r=>r.kind),['matched','matched','no_product','no_product']);assert.equal(rows[1].product?.flavorMasterProductId,id(12));
 assert.equal(activeProductsMissingImages([...catalog,product(13,'HIDDEN',{status:'hidden'}),product(14,'WITH',{imageUrl:'existing'})]).length,2);
});
test('duplicate files and ambiguous normalized catalog SKUs fail closed before any upload',async()=>{
 const p=product(10,'SUG-10'),f=fixture([p]);
 assert.deepEqual(matchProductImages([file('sug-10.jpg'),file('SUG-١٠.png')],[p]).map(r=>r.kind),['duplicate','duplicate']);
 assert.equal(matchProductImages([file('sug-10.jpg')],[p,product(11,'sug-١٠')])[0].kind,'ambiguous');
 const rows=f.rows();rows[0].match.kind='duplicate';await assert.rejects(()=>runBulkImageUpload(rows,f.deps,()=>{}),/المكررة/u);assert.equal(f.uploads.length,0);
});
test('only the existing product edit roles can start;inactive,locked,unassigned and MFA-pending actors have zero work',async()=>{
 const base={isAuthenticated:true,isSessionLocked:false,mfaRequired:false,roleName:'owner',roles:['owner'],profile:{id:owner,is_active:true},user:{id:owner}} as BulkImageAuth;
 for(const role of ['owner','admin','manager','warehouse_keeper'])assert.equal(canUploadProductImages({...base,roles:[role],roleName:role}),true,role);
 for(const role of ['cashier','sales','accountant','view_only','unassigned'])assert.equal(canUploadProductImages({...base,roles:[role],roleName:role}),false,role);
 for(const auth of [{...base,isAuthenticated:false},{...base,isSessionLocked:true},{...base,mfaRequired:true},{...base,profile:{id:owner,is_active:false}}])assert.equal(canUploadProductImages(auth),false);
 const f=fixture([product(10,'A')]);f.deps.canEdit=()=>false;await assert.rejects(()=>runBulkImageUpload(f.rows(),f.deps,()=>{}),/صلاحية/u);assert.equal(f.uploads.length,0);
});
test('default skip,explicit replacement and re-selection/reload resume never upload a completed fingerprint twice',async()=>{
 const f=fixture([product(10,'A',{imageUrl:'existing'})]),rows=f.rows();
 assert.equal((await runBulkImageUpload(rows,f.deps,()=>{}))[0].outcome,'skipped');assert.equal(f.uploads.length,0);
 rows[0].replace=true;assert.equal((await runBulkImageUpload(rows,f.deps,()=>{}))[0].outcome,'success');assert.equal(f.uploads.length,1);
 f.deps.journal=createImageJournal(f.storage,origin,owner);
 assert.equal((await runBulkImageUpload(rows,f.deps,()=>{}))[0].outcome,'skipped');assert.equal(f.uploads.length,1);
});
test('definitive failure in the middle removes only the unreferenced new upload;retry completes and has no orphans',async()=>{
 const f=fixture([product(10,'A'),product(11,'B'),product(12,'C')]),normal=f.deps.save;let fail=true;
 f.deps.save=async(p,url)=>p.sku==='B'&&fail?{success:false,error:'رفض وهمي مؤكد'}:normal(p,url);
 const rows=f.rows(),results=await runBulkImageUpload(rows,f.deps,()=>{});assert.equal(results.filter(r=>r.outcome==='success').length,2);assert.equal(results.filter(r=>r.outcome==='failed').length,1);assert.equal(f.removed.length,1);assert.equal(f.stored.size,2);
 fail=false;await runBulkImageUpload(rows.filter(r=>r.match.product?.sku==='B'),f.deps,()=>{});assert.equal(f.stored.size,3);assert.equal(f.references.size,3);assert.equal(f.journal.all().every(e=>e.stage==='confirmed'),true);
});
test('commit followed by lost reply is recognized without deleting the committed image',async()=>{
 const f=fixture([product(10,'A')]),normal=f.deps.save;f.deps.save=async(p,url)=>{await normal(p,url);throw new Error('انقطع الرد الوهمي');};
 assert.equal((await runBulkImageUpload(f.rows(),f.deps,()=>{}))[0].outcome,'success');assert.equal(f.removed.length,0);assert.equal(f.stored.size,1);
});
test('a delayed unknown DB commit never races cleanup;next run recognizes the later commit',async()=>{
 const f=fixture([product(10,'A')]),normal=f.deps.save;let late:(()=>Promise<unknown>)|undefined;
 f.deps.save=async(p,url)=>{late=()=>normal(p,url);return {success:false,uncertain:true,error:'انقطاع وهمي'};};
 assert.equal((await runBulkImageUpload(f.rows(),f.deps,()=>{}))[0].outcome,'failed');assert.equal(f.removed.length,0);assert.equal(f.journal.all()[0].stage,'uncertain');
 assert.ok(late);await late();f.deps.save=normal;assert.equal((await runBulkImageUpload(f.rows(),f.deps,()=>{}))[0].outcome,'skipped');assert.equal(f.uploads.length,1);
});
test('unknown Storage outcome replays the same durable path,without upsert or an orphan',async()=>{
 const f=fixture([product(10,'A')]),normal=f.deps.upload;let pending:ImageJournalEntry|undefined;
 f.deps.upload=async(_file,before)=>{const storagePath=owner+'/'+id(900)+'.jpg',publicUrl=origin+'/storage/v1/object/public/product-images/'+storagePath;before({storagePath,publicUrl});pending=f.journal.all()[0];return {success:false,uncertain:true,error:'انقطاع وهمي'};};
 await runBulkImageUpload(f.rows(),f.deps,()=>{});assert.equal(f.removed.length,0);assert.equal(pending?.stage,'prepared');assert.ok(pending);f.stored.add(pending.storagePath);
 f.deps.upload=normal;assert.equal((await runBulkImageUpload(f.rows(),f.deps,()=>{}))[0].outcome,'success');assert.deepEqual(f.uploads,[pending.storagePath]);assert.equal(f.stored.size,1);
});
test('cleanup failure stays durable and must resolve before allocating another path',async()=>{
 const f=fixture([product(10,'A')]),normalSave=f.deps.save,normalRemove=f.deps.remove;
 f.deps.save=async()=>({success:false,error:'رفض وهمي'});f.deps.remove=async()=>false;
 await runBulkImageUpload(f.rows(),f.deps,()=>{});assert.equal(f.journal.all()[0].stage,'cleanup_pending');const path=f.uploads[0];
 f.deps.save=normalSave;f.deps.remove=normalRemove;await runBulkImageUpload(f.rows(),f.deps,()=>{});assert.ok(f.removed.includes(path));assert.equal(f.stored.size,1);assert.equal(f.journal.all()[0].stage,'confirmed');
});
test('a secondary or another-product DB reference is retained,never deleted on cleanup',async()=>{
 const f=fixture([product(10,'A')]),entry:ImageJournalEntry={productId:id(10),sku:'A',fileName:'A.jpg',fingerprint,publicUrl:origin+'/storage/v1/object/public/product-images/'+owner+'/'+id(50)+'.jpg',storagePath:owner+'/'+id(50)+'.jpg',previousImageUrl:'',stage:'uploaded',at:1};
 f.journal.put(entry);f.references.add(entry.publicUrl);assert.equal(await reconcileImage(entry,f.deps),'retained');assert.equal(f.removed.length,0);
});
test('journal must persist before Storage;quota failure starts zero uploads',async()=>{
 const f=fixture([product(10,'A')]);f.deps.journal=createImageJournal({getItem:()=>null,setItem:()=>{throw new Error('quota');}},origin,owner);
 assert.equal((await runBulkImageUpload(f.rows(),f.deps,()=>{}))[0].outcome,'failed');assert.equal(f.uploads.length,0);assert.equal(f.stored.size,0);
});
test('cleanup phase must be durable before deleting bytes,so a quota failure cannot cause reuse of a deleted file',async()=>{
 const f=fixture([product(10,'A')]),normal=f.deps.save;
 f.deps.save=async()=>({success:false,error:'رفض مؤكد'});f.deps.remove=async()=>false;await runBulkImageUpload(f.rows(),f.deps,()=>{});
 const entry=f.journal.all()[0];assert.ok(entry);const journal=f.deps.journal;
 f.deps.journal={...journal,put:()=>{throw new Error('quota');}};let deleted=false;f.deps.remove=async()=>{deleted=true;return true;};
 assert.equal(await reconcileImage(entry,f.deps),'pending');assert.equal(deleted,false);assert.equal(f.stored.size,1);f.deps.save=normal;
});
test('journal is scoped to project and actor;malformed or cross-user paths fail closed',()=>{
 const storage=memory(),journal=createImageJournal(storage,origin,owner),entry:ImageJournalEntry={productId:id(10),sku:'A',fileName:'A.jpg',fingerprint,publicUrl:origin+'/storage/v1/object/public/product-images/'+owner+'/'+id(50)+'.jpg',storagePath:owner+'/'+id(50)+'.jpg',previousImageUrl:'',stage:'prepared',at:1};
 journal.put(entry);assert.equal(createImageJournal(storage,origin,id(2)).all().length,0);assert.equal(createImageJournal(storage,'http://127.0.0.1:54322',owner).all().length,0);
 assert.throws(()=>journal.put({...entry,storagePath:id(2)+'/'+id(50)+'.jpg'}),/غير صالحة/u);
 const key=[...storage.map.keys()][0];storage.map.set(key,'broken');assert.throws(()=>createImageJournal(storage,origin,owner),/لا تحذفه/u);
});
test('two workers are the concurrency ceiling and a route abort stops starting new files',async()=>{
 const f=fixture(Array.from({length:8},(_,i)=>product(10+i,'P'+i))),normal=f.deps.upload;let active=0,max=0;
 f.deps.upload=async(...args)=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,10));try{return await normal(...args);}finally{active--;}};
 assert.equal((await runBulkImageUpload(f.rows(),f.deps,()=>{})).length,8);assert.equal(max,2);
 const abort=new AbortController();abort.abort();assert.deepEqual(await runBulkImageUpload(f.rows(),f.deps,()=>{},abort.signal),[]);
});
