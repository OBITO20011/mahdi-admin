import assert from 'node:assert/strict';
import test from 'node:test';
import {epochTemplate,parseEpochSheet,parseEpochCatalog,parseEpochPreview,epochTotals,canonicalEpochRows,type EpochRow} from '../src/features/operatingMode/openingEpoch';
import {prepareOpeningEpochAttempt,readOpeningEpochAttempt,runOpeningEpochAttemptWithClient,openingEpochJournalKey,previewOpeningEpochWithClient,type EpochClient} from '../src/services/supabase/openingEpoch.service';
import {writeXlsx,readXlsxFirstSheet} from '../src/lib/xlsx';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(1),rows:EpochRow[]=[{productId:id(2),warehouseId:id(3),actualQuantity:3,unitCostInMinorUnits:333},{productId:id(2),warehouseId:id(4),actualQuantity:0,unitCostInMinorUnits:333}],catalog=rows.map((r,i)=>({...r,sku:'00001',productName:'اسم وهمي',warehouseName:'مستودع '+i,baseUnitName:'باكيت',previousQuantity:0}));
const rawPreview={contractVersion:'sales-only-epoch2-v1',previewFingerprint:'a'.repeat(64),itemCount:2,lines:rows.map(r=>({...r,previousQuantity:0})),...epochTotals(rows)},preview=parseEpochPreview(rawPreview,rows),result={success:true,epochId:id(9),activatedAt:'2026-11-09T20:00:00Z',fullAccounting:true,itemCount:2,...epochTotals(rows)};
function storage(){const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};}
function client(rpc:EpochClient['rpc']):EpochClient{return {auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2'},error:null})}},rpc};}
test('activation workbook reuses XLSX and exact integer fils;blank is not zero,all warehouse rows required',async()=>{
 const sheet=epochTemplate(catalog);assert.equal(sheet[1][0],'00001');assert.equal(sheet[1][3],'');assert.equal(parseEpochSheet(sheet,catalog).rows.length,0);
 sheet[1][3]='٣';sheet[1][4]='٠٫٣٣٣';sheet[2][3]='٠';sheet[2][4]='0.333';const decoded=await readXlsxFirstSheet(writeXlsx([{name:'جرد',rows:sheet}]));assert.deepEqual(parseEpochSheet(decoded,catalog),{rows,errors:[]});assert.deepEqual(epochTotals(rows),{totalQuantity:'3',totalValueExact:'999'});
 for(const broken of [[sheet[0],sheet[1]],[...sheet,sheet[1]],sheet.map((r,i)=>i===2?r.map((v,j)=>j===4?'0':v):r),sheet.map((r,i)=>i===1?r.map((v,j)=>j===5?id(99):v):r),sheet.map((r,i)=>i===1?r.map((v,j)=>j===4?'0.0001':v):r)])assert.ok(parseEpochSheet(broken,catalog).errors.length);
 assert.throws(()=>canonicalEpochRows([{...rows[0],unitCostInMinorUnits:Number.MAX_SAFE_INTEGER}]));assert.throws(()=>canonicalEpochRows([{...rows[0],actualQuantity:1,unitCostInMinorUnits:0}]));
});
test('manifest and preview require exact membership,nonnegative quantities,totalvalue and validfingerprint',()=>{
 const value={contractVersion:'sales-only-epoch-catalog2-v1',fullAccounting:false,itemCount:2,rows:catalog};assert.equal(parseEpochCatalog(value).length,2);assert.throws(()=>parseEpochCatalog({...value,rows:[catalog[0],catalog[0]]}));assert.throws(()=>parseEpochCatalog({...value,fullAccounting:true}));
 for(const broken of [{...rawPreview,itemCount:1},{...rawPreview,totalValueExact:'1000'},{...rawPreview,lines:[{...rows[0],actualQuantity:4,previousQuantity:0},rawPreview.lines[1]]},{...rawPreview,previewFingerprint:'x'}])assert.throws(()=>parseEpochPreview(broken,rows));
});
test('activation journal persists before network andlost reply recovers same key/body exactlyonce;success replay no mutation',async()=>{
 const disk=storage(),attempt=prepareOpeningEpochAttempt(actor,preview,'جرد فعلي وهمي',disk),bodies:Record<string,unknown>[]=[];const commits=new Set<string>();let lost=true;
 const api=client(async(name,args)=>{assert.equal(name,'lite1_activate_epoch2');assert.equal(readOpeningEpochAttempt(actor,disk)?.status,'IN_FLIGHT');bodies.push(structuredClone(args!));commits.add(args!.p_key as string);if(lost){lost=false;throw Error('simulated lost response');}return {data:result,error:null};});
 await assert.rejects(runOpeningEpochAttemptWithClient(api,actor,disk));assert.equal(readOpeningEpochAttempt(actor,disk)?.status,'OUTCOME_UNKNOWN');assert.throws(()=>prepareOpeningEpochAttempt(actor,preview,'جرد جديد ممنوع',disk,true));
 assert.deepEqual(await runOpeningEpochAttemptWithClient(api,actor,disk),result);assert.deepEqual(bodies[0],bodies[1]);assert.equal(bodies[0].p_key,attempt.key);assert.equal(commits.size,1);assert.deepEqual(await runOpeningEpochAttemptWithClient(api,actor,disk),result);assert.equal(bodies.length,2);
 const next=prepareOpeningEpochAttempt(actor,preview,'جرد لاحق صريح',disk,true);assert.notEqual(next.key,attempt.key);assert.equal(JSON.parse(disk.data.get(openingEpochJournalKey(actor)+':previous:'+attempt.key)!).result.epochId,result.epochId);
});
test('corrupt journal/storage failure/actor switch/AAL1 cannotsend;unknown response neverbecomes success',async()=>{
 const disk=storage(),key=openingEpochJournalKey(actor);disk.setItem(key,'{broken');const raw=disk.getItem(key);assert.throws(()=>readOpeningEpochAttempt(actor,disk));assert.throws(()=>prepareOpeningEpochAttempt(actor,preview,'جرد وهمي',disk));assert.equal(disk.getItem(key),raw);
 assert.throws(()=>prepareOpeningEpochAttempt(actor,preview,'جرد وهمي',{getItem:()=>null,setItem:()=>{throw Error('full');}}));const d=storage();prepareOpeningEpochAttempt(actor,preview,'جرد وهمي',d);let calls=0;const api=client(async()=>{calls++;return {data:result,error:null};});api.auth.mfa.getAuthenticatorAssuranceLevel=async()=>({data:{currentLevel:'aal1'},error:null});await assert.rejects(runOpeningEpochAttemptWithClient(api,actor,d));assert.equal(calls,0);
 api.auth.mfa.getAuthenticatorAssuranceLevel=async()=>({data:{currentLevel:'aal2'},error:null});let users=0;api.auth.getUser=async()=>({data:{user:{id:++users===1?actor:id(50)}},error:null});await assert.rejects(previewOpeningEpochWithClient(api,actor,rows,'جرد وهمي'));assert.equal(calls,0);
 const malformed=client(async()=>({data:{...result,totalValueExact:'998'},error:null}));await assert.rejects(runOpeningEpochAttemptWithClient(malformed,actor,d));assert.equal(readOpeningEpochAttempt(actor,d)?.status,'OUTCOME_UNKNOWN');
});
test('only a specifically known first SQL rejection allows explicit new attempt;unknown previous outcome stays fenced',async()=>{
 const d=storage();prepareOpeningEpochAttempt(actor,preview,'جرد وهمي',d);const reject=client(async()=>({data:null,error:{code:'P0001',message:'LITE2_EPOCH_PREVIEW_CHANGED'}}));await assert.rejects(runOpeningEpochAttemptWithClient(reject,actor,d));assert.equal(readOpeningEpochAttempt(actor,d)?.status,'DEFINITIVELY_REJECTED');const next=prepareOpeningEpochAttempt(actor,preview,'جرد بعد التصحيح',d,true);
 const lose=client(async()=>{throw Error('network');});await assert.rejects(runOpeningEpochAttemptWithClient(lose,actor,d));await assert.rejects(runOpeningEpochAttemptWithClient(reject,actor,d));assert.equal(readOpeningEpochAttempt(actor,d)?.status,'OUTCOME_UNKNOWN');assert.equal(readOpeningEpochAttempt(actor,d)?.key,next.key);
});
