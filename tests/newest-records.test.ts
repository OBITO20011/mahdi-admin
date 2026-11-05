import{pathsBeforeStorefrontImages}from'../scripts/audit/source-before-storefront-images.mjs';
import{sourceBeforeProductScale}from'../scripts/audit/source-before-product-scale.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {newestRecords} from '../src/utils/newestRecords';
const read=(f:string)=>readFileSync(f,'utf8');
test('complete histories display newest timestamps first without changing records, amounts, identity or input order',()=>{
 const old=Object.freeze({id:'a',at:'2026-11-01T12:00:00Z',amount:'9007199254740993123',quantity:12,canReverse:false}),recent=Object.freeze({id:'b',at:'2026-11-02T09:00:00+03:00',amount:'-500',quantity:1,canReverse:true});
 const rows=Object.freeze([old,recent]);const sorted=newestRecords(rows,r=>r.at,r=>r.id);assert.deepEqual(sorted,[recent,old]);assert.equal(sorted[0],recent);assert.equal(sorted[1],old);assert.deepEqual(rows,[old,recent]);assert.notEqual(sorted,rows);
});
test('absolute timestamps, exact ties, unknown dates and empty complete histories are deterministic',()=>{
 const rows=[{id:'a',at:'2026-11-01T12:00:00+03:00'},{id:'z',at:'2026-11-01T09:00:00Z'},{id:'unknown',at:null},{id:'broken',at:'invalid'}];
 assert.deepEqual(newestRecords(rows,r=>r.at,r=>r.id).map(r=>r.id),['z','a','unknown','broken']);
 assert.deepEqual(newestRecords(rows.slice(0,2),r=>r.at),rows.slice(0,2));assert.deepEqual(newestRecords([],()=>null),[]);
});
test('server pages, running balances, all writer services, migrations and owner tools stay byte identical to delivered main52',()=>{
 const base='52c9a8b53f9e1d2bad504c88f9c6255547b09e7c';
 const diff=execFileSync('git',['diff','--name-only',base,'--','supabase','src/services','scripts/operations','scripts/backup','src/utils/customerStatement.ts','src/hooks/useCustomerStatement.ts'],{encoding:'utf8',windowsHide:true}).trim().split('\n').filter(Boolean);
 const historicalChanges=pathsBeforeStorefrontImages(diff,'d102074583c7369502954eaf8ea70d2595f6a19c');
 for(const file of historicalChanges){assert.ok(['src/services/supabase/productWorkbook.service.ts','scripts/operations/go-live-files/check.ts'].includes(file),file);assert.equal(sourceBeforeProductScale(file,read(file)),execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true}),file);}
 const panel=read('src/features/inventory/SupplierReplacementPanel.tsx');assert.match(panel,/page\.cases\.map/u);assert.doesNotMatch(panel,/newestRecords\(page\.cases|page\.cases\.reverse/u);
 assert.match(panel,/newestRecords\(c\.events,e=>e\.occurredAt,e=>e\.id\)/u);
 assert.match(read('src/features/cheques/ChequesView.tsx'),/\[\.\.\.detail\.events\]\.reverse\(\)/u);
});
function latestBody(name:string){let body='';for(const f of readdirSync('supabase/migrations').filter(f=>/^\d{3}_.*\.sql$/u.test(f)).sort()){
 const text=read('supabase/migrations/'+f);for(const match of text.matchAll(new RegExp('CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.'+name+'\\s*\\(','giu'))){const rest=text.slice(match.index),tag=/\bAS\s+(\$[\w]*\$)/iu.exec(rest);assert.ok(tag);const start=tag.index+tag[0].length,end=rest.indexOf(tag[1],start);assert.ok(end>start);body=rest.slice(start,end);}}
 assert.ok(body,name);return body;
}
test('documented paged-reader barriers reflect the LATEST SQL and no partial-page inversion claims newest globally',()=>{
 assert.match(latestBody('get_supplier_replacements_page_v1'),/ORDER BY occurred_at,id LIMIT p_page_size OFFSET/u);
 assert.match(latestBody('get_deferred_cheques_page'),/ORDER BY due_date,id OFFSET/u);
 const doc=read('docs/operations/RECORD_ORDER_AUDIT_AR.md');for(const term of ['get_supplier_replacements_page_v1','get_deferred_cheques_page','متوقف','لا نعكس'])assert.ok(doc.includes(term),term);
});
test('parcel activation copy explains pause and retention without changing its checkbox state or setter',()=>{
 const s=read('src/features/more/ParcelConfigurationModal.tsx');assert.ok(s.includes('الطرد المشكّل مفعّل للبيع'));assert.ok(s.includes('أزل الإشارة لإيقافه مؤقتاً؛ يبقى الإعداد محفوظاً.'));assert.ok(s.includes('checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}'));
});
