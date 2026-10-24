import {pathsBeforeHandover213} from '../scripts/audit/source-before-handover213.mjs';
import {parseCashDocumentDisplay} from '../src/services/supabase/cashDocumentDisplay.service';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {orderProductChoices} from '../src/components/ui/productPickerModel';
import {parseDamageHistoryPage} from '../src/services/supabase/damageHistory.service';
import {parseCashShiftMovementPage} from '../src/services/supabase/cashShiftMovements.service';
import {sourceBeforeTrialR,trialRPins} from '../scripts/audit/source-before-trial-owner-r.mjs';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
test('R exact additive inverse restores88c7bd4 and rejects even one unexpected byte',()=>{
 for(const [file,pin]of Object.entries(trialRPins) as [string,{added?:boolean}][]){const current=read(file),before=sourceBeforeTrialR(file,current);assert.throws(()=>sourceBeforeTrialR(file,current+'\nvoid unapproved;\n'),file);if(pin.added)assert.equal(before,null);else assert.equal(before,execFileSync('git',['show','88c7bd446ab19338d320108a86ea25cddcbf6d2d:'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n'),file);}
});
test('212 contains only approved read functions;206 money attribution remains byte-identical',()=>{
 const sql=read('supabase/migrations/212_trial_readable_cash_product_choices_damage_history.sql');assert.equal((sql.match(/CREATE(?: OR REPLACE)? FUNCTION/gu)??[]).length,4);assert.doesNotMatch(sql,/\b(?:CREATE TABLE|ALTER TABLE|INSERT INTO|UPDATE public|DELETE FROM|CREATE POLICY|FOR UPDATE)\b/iu);
 for(const name of ['trial212_cash_metadata_internal','get_cash_shift_movement_page','get_supplier_replacement_options_v1','get_damage_history_page_v1'])assert.match(sql,new RegExp('FUNCTION public\\.'+name+'\\('));
 const old=read('supabase/migrations/206_cash_shift_movement_read_model.sql'),body=(s:string)=>s.slice(s.indexOf('DECLARE\n  v_shift'),s.indexOf('$function$;'));
 assert.equal(body(sql).replace("'note',note)||public.trial212_cash_metadata_internal(source,id)","'note',note)"),body(old));
 assert.match(sql,/sr208_assert_role_internal\('read'\)/u);assert.match(sql,/IF owner_values THEN/u);assert.match(sql,/REVOKE ALL ON FUNCTION public\.trial212_cash_metadata_internal/);assert.match(sql,/STABLE SECURITY DEFINER/g);
 const admitted=read('scripts/agent/preflight.mjs').match(/for\(const number of \[([^\]]+)\]/u)![1].split(',').map(Number);assert.ok(admitted.includes(212),'Takeover must enforce the approved212 hash');
 const changed=execFileSync('git',['diff','--name-only','88c7bd446ab19338d320108a86ea25cddcbf6d2d','--','supabase'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);assert.deepEqual(pathsBeforeHandover213(changed).filter(f=>!f.startsWith('supabase/migrations/212_')),[]);
});
test('Shared choices preserve all options and stable server order within stock buckets,without mutating caller',()=>{
 const choices=[{id:'zero',name:'صفر',available:0,unit:'باكيت'},{id:'positive',name:'متاح',available:2,unit:'باكيت'},{id:'unknown',name:'غير معروف',available:null,unit:'باكيت'},{id:'positive2',name:'متاح2',available:1,unit:'باكيت'}],before=structuredClone(choices);
 assert.deepEqual(orderProductChoices(choices).map(r=>r.id),['positive','positive2','unknown','zero']);assert.deepEqual(choices,before);
});
const row={source:'damage',id:'damage',productId:'product',productName:'عصير',unitName:'باكيت',quantity:2,reasonCode:'shop_breakage',reason:'انكسر',occurredAt:'2026-10-23T10:00:00Z',origin:'shop',isReversed:false,isReclassified:false};
const page={contractVersion:212,page:1,pageSize:25,totalCount:1,fromDate:'2026-10-23',toDate:'2026-10-23',rows:[row]};
test('History parses original owner loss separately from reversal status;staff has no synthetic loss',()=>{
 assert.equal(parseDamageHistoryPage(page).rows[0].lossAtRegistrationInMinorUnits,undefined);const owner=parseDamageHistoryPage({...page,rows:[{...row,isReversed:true,lossAtRegistrationInMinorUnits:2000}]});assert.equal(owner.rows[0].lossAtRegistrationInMinorUnits,2000);assert.equal(owner.rows[0].isReversed,true);
});
test('History rejects unsafe quantity/money,missing status,duplicates,invalid date and page counts',()=>{
 for(const bad of [{...page,rows:[{...row,quantity:0}]},{...page,rows:[{...row,quantity:'2'}]},{...page,rows:[{...row,lossAtRegistrationInMinorUnits:Number.MAX_SAFE_INTEGER+1}]},{...page,rows:[{...row,isReversed:null}]},{...page,rows:[{...row,occurredAt:'invalid'}]},{...page,totalCount:2,rows:[row,row]},{...page,pageSize:101},{...page,totalCount:2}])assert.throws(()=>parseDamageHistoryPage(bad));
});
test('Cash summary accepts typed parcel quantities and authoritative document;rejects incomplete metadata',()=>{
 const cash={shiftId:'shift',kind:'sales',method:'cash',generatedAt:row.occurredAt,shiftStatus:'open',canonicalAmountInMinorUnits:15000,totalAmountInMinorUnits:15000,totalCount:1,page:1,pageSize:25,totalPages:1,evidenceStatus:'matched',rows:[{source:'order',id:'order',reference:'POS-1',at:row.occurredAt,method:'cash',amountInMinorUnits:15000,note:null,displayTitle:'زبون نقدي',itemsPreview:[{name:'شيبس',quantity:1,unit:'طرد'}],itemCount:1,document:{type:'order',id:'order'}}]};assert.equal(parseCashShiftMovementPage(cash).rows[0].itemsPreview?.[0].quantity,1);
 for(const bad of [{...cash.rows[0],document:null},{...cash.rows[0],document:{type:'arbitrary',id:'order'}},{...cash.rows[0],itemsPreview:[{name:'شيبس',quantity:0,unit:'طرد'}]}])assert.throws(()=>parseCashShiftMovementPage({...cash,rows:[bad]}));
});

test('Cash purchase document projections cannot request financial fields and validate exact identity/quantities',()=>{
 const raw={id:'receipt',receipt_number:'GRN-1',suppliers:{company_name:'المورد'},supplier_receipt_items:[{id:'line',total_base_units:10,base_unit_name:'باكيت',products:{name_ar:'شيبس'}}]};assert.equal(parseCashDocumentDisplay(raw,'receipt','supplier_receipt').lines[0].quantity,10);assert.throws(()=>parseCashDocumentDisplay(raw,'other','supplier_receipt'));assert.throws(()=>parseCashDocumentDisplay({...raw,supplier_receipt_items:[{...raw.supplier_receipt_items[0],total_base_units:-1}]},'receipt','supplier_receipt'));
 const source=read('src/services/supabase/cashDocumentDisplay.service.ts');const selections=[...source.matchAll(/\.select\('([^']+)'\)/gu)].map(match=>match[1]);assert.equal(selections.length,2);assert.ok(selections.every(select=>!select.includes('*')&&!/cost|price|amount|profit|wac/iu.test(select)));
});
