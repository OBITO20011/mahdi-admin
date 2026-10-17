import {supabase} from '../../lib/supabase';
import {readCheque,type Cheque} from './cheques.service';
import type {RowError} from '../../features/goLive/goLiveImport';

export type OpeningChequeRow=Record<string,string|number>;
export interface OpeningChequeParty {kind:'customer'|'supplier';id:string;name:string;entered:number;cheques:number;beforeCheques:number}
export interface OpeningChequePreview {errors:RowError[];rowCount:number;validCount:number;parties:OpeningChequeParty[]}
export interface OpeningChequePage {entries:Cheque[];page:number;hasMore:boolean;totalCount:number;incoming:number;outgoing:number;endorsed:number}
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('استجابة الشيكات الافتتاحية غير مكتملة.');return x as Record<string,unknown>;};
const list=(x:unknown):unknown[]=>{if(!Array.isArray(x))throw Error('قائمة الشيكات الافتتاحية غير مكتملة.');return x;};
const text=(x:unknown)=>{if(typeof x!=='string')throw Error('نص مفقود من قارئ الشيكات الافتتاحية.');return x;};
const number=(x:unknown)=>{const n=typeof x==='string'&&/^-?\d+$/u.test(x)?Number(x):x;if(typeof n!=='number'||!Number.isSafeInteger(n))throw Error('مبلغ أو عداد غير صالح.');return n;};
const client=()=>{if(!supabase)throw Error('الاتصال بقاعدة البيانات غير جاهز.');return supabase;};
const settle=async(request:PromiseLike<{data:unknown;error:{message:string;details?:string}|null}>)=>{const {data,error}=await request;if(error)throw Error(error.message);return obj(data);};
const parties=(value:unknown):OpeningChequeParty[]=>list(value).map(item=>{const r=obj(item);if(r.kind!=='customer'&&r.kind!=='supplier')throw Error('نوع طرف غير صالح.');
 return {kind:r.kind,id:text(r.id),name:text(r.name),entered:number(r.enteredInMinorUnits),cheques:number(r.chequesInMinorUnits),beforeCheques:number(r.beforeChequesInMinorUnits)};});
export async function previewOpeningCheques(branchId:string,rows:readonly OpeningChequeRow[]):Promise<OpeningChequePreview>{
 const r=await settle(client().rpc('preview_go_live_cheques_v1',{p_branch_id:branchId,p_rows:rows}));
 return {rowCount:number(r.rowCount),validCount:number(r.validCount),parties:parties(r.parties),
  errors:list(r.errors).map(e=>{const row=obj(e);return {row:number(row.row),message:text(row.message)};})};
}
export async function saveOpeningCheques(branchId:string,key:string,rows:readonly OpeningChequeRow[]){
 const r=await settle(client().rpc('record_go_live_cheques_v1',{p_branch_id:branchId,p_idempotency_key:key,p_rows:rows}));
 if(r.success!==true||number(r.balanceEffectInMinorUnits)!==0)throw Error('استجابة حفظ الشيكات غير صالحة.');
 return {created:list(r.created).length,replay:r.idempotentReplay===true};
}
export async function fetchOpeningCheques(page=1):Promise<OpeningChequePage>{
 const r=await settle(client().rpc('get_go_live_cheques_v1',{p_page:page,p_page_size:25}));
 return {entries:list(r.entries).map(readCheque),page:number(r.page),hasMore:r.hasMore===true,totalCount:number(r.totalCount),
  incoming:number(r.incomingPendingInMinorUnits),outgoing:number(r.outgoingPendingInMinorUnits),endorsed:number(r.endorsedInMinorUnits)};
}
