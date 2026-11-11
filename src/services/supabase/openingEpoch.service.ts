import {supabase,isSupabaseConfigured,sanitizedSupabaseUrl} from '../../lib/supabase';
import {withAdminActionLock} from './adminCustomerV2Lifecycle';
import {canonicalEpochRows,epochInvalid,epochRecord,epochTotals,epochUuid,parseEpochCatalog,parseEpochPreview,type EpochPreview,type EpochRow} from '../../features/operatingMode/openingEpoch';
interface Response {data:unknown;error:{code?:string;message?:string}|null}
export interface EpochClient {auth:{getUser:()=>PromiseLike<{data:{user:{id:string}|null};error:unknown}>;mfa:{getAuthenticatorAssuranceLevel:()=>PromiseLike<{data:{currentLevel:string|null}|null;error:unknown}>}};rpc:(name:'lite1_epoch_catalog2'|'lite1_preview_epoch2'|'lite1_activate_epoch2',args?:Record<string,unknown>)=>PromiseLike<Response>}
export interface EpochResult {success:true;epochId:string;activatedAt:string;fullAccounting:true;itemCount:number;totalQuantity:string;totalValueExact:string}
export interface EpochAttempt {version:1;actorId:string;key:string;rows:EpochRow[];notes:string;preview:string;status:'PREPARED'|'IN_FLIGHT'|'OUTCOME_UNKNOWN'|'DEFINITIVELY_REJECTED'|'SUCCEEDED';hadUnknown:boolean;result?:EpochResult}
export type EpochStorage=Pick<Storage,'getItem'|'setItem'>;
const prefix='nawasrah:opening-epoch2:'+sanitizedSupabaseUrl+':';
export const openingEpochJournalKey=(actorId:string)=>prefix+actorId;
const notesText=(s:string)=>{const value=s.trim();if(value.length<5||value.length>500)throw epochInvalid();return value;};
function result(value:unknown,rows:readonly EpochRow[]):EpochResult {
 const totals=epochTotals(rows);if(!epochRecord(value)||value.success!==true||!epochUuid(value.epochId)||value.fullAccounting!==true||typeof value.activatedAt!=='string'||!Number.isFinite(Date.parse(value.activatedAt))||value.itemCount!==rows.length||value.totalQuantity!==totals.totalQuantity||value.totalValueExact!==totals.totalValueExact)throw epochInvalid();
 return {success:true,epochId:value.epochId,activatedAt:value.activatedAt,fullAccounting:true,itemCount:rows.length,...totals};
}
export function readOpeningEpochAttempt(actorId:string,storage:EpochStorage):EpochAttempt|null{
 if(!epochUuid(actorId))throw epochInvalid();let value:unknown;try{const raw=storage.getItem(openingEpochJournalKey(actorId));if(raw===null)return null;value=JSON.parse(raw);}catch{throw epochInvalid();}
 if(!epochRecord(value)||value.version!==1||value.actorId!==actorId||!epochUuid(value.key)||typeof value.notes!=='string'||notesText(value.notes)!==value.notes||typeof value.preview!=='string'||!/^[a-f0-9]{64}$/u.test(value.preview)||typeof value.hadUnknown!=='boolean'||!['PREPARED','IN_FLIGHT','OUTCOME_UNKNOWN','DEFINITIVELY_REJECTED','SUCCEEDED'].includes(String(value.status)))throw epochInvalid();
 const rows=canonicalEpochRows(value.rows),status=value.status as EpochAttempt['status'];
 if((status==='SUCCEEDED')!==(value.result!==undefined)||(status==='DEFINITIVELY_REJECTED'&&value.hadUnknown))throw epochInvalid();
 return {version:1,actorId,key:value.key,rows,notes:value.notes,preview:value.preview,status,hadUnknown:value.hadUnknown,...(status==='SUCCEEDED'?{result:result(value.result,rows)}:{})};
}
function saveAttempt(attempt:EpochAttempt,storage:EpochStorage){const raw=JSON.stringify(attempt);try{storage.setItem(openingEpochJournalKey(attempt.actorId),raw);if(storage.getItem(openingEpochJournalKey(attempt.actorId))!==raw)throw epochInvalid();}catch{throw epochInvalid();}}
async function identity(client:EpochClient,actorId:string){
 if(!epochUuid(actorId))throw epochInvalid();const first=await client.auth.getUser();if(first.error||first.data.user?.id!==actorId)throw epochInvalid();const aal=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(aal.error||aal.data?.currentLevel!=='aal2')throw epochInvalid();const last=await client.auth.getUser();if(last.error||last.data.user?.id!==actorId)throw epochInvalid();
}
export async function readEpochCatalogWithClient(client:EpochClient,actorId:string){await identity(client,actorId);const r=await client.rpc('lite1_epoch_catalog2',{});if(r.error)throw epochInvalid();await identity(client,actorId);return parseEpochCatalog(r.data);}
export async function previewOpeningEpochWithClient(client:EpochClient,actorId:string,rowsInput:readonly EpochRow[],notes:string){
 const rows=canonicalEpochRows(rowsInput),cleanNotes=notesText(notes);await identity(client,actorId);const r=await client.rpc('lite1_preview_epoch2',{p_rows:rows,p_notes:cleanNotes});if(r.error)throw epochInvalid();await identity(client,actorId);return parseEpochPreview(r.data,rows);
}
/** Called under the same cross-tab lock as execution. No ambiguous attempt is
 * removed or replaced. Resolved evidence is archived before an explicit new one. */
export function prepareOpeningEpochAttempt(actorId:string,preview:EpochPreview,notes:string,storage:EpochStorage,replaceResolved=false){
 if(!epochUuid(actorId)||!/^[a-f0-9]{64}$/u.test(preview.fingerprint))throw epochInvalid();const previous=readOpeningEpochAttempt(actorId,storage);
 if(previous){if(!replaceResolved||!['SUCCEEDED','DEFINITIVELY_REJECTED'].includes(previous.status))throw epochInvalid();const archive=openingEpochJournalKey(actorId)+':previous:'+previous.key,raw=JSON.stringify(previous),saved=storage.getItem(archive);if(saved!==null&&saved!==raw)throw epochInvalid();storage.setItem(archive,raw);if(storage.getItem(archive)!==raw)throw epochInvalid();}
 const rows=canonicalEpochRows(preview.rows);if(JSON.stringify(epochTotals(rows))!==JSON.stringify({totalQuantity:preview.totalQuantity,totalValueExact:preview.totalValueExact}))throw epochInvalid();
 const attempt:EpochAttempt={version:1,actorId,key:crypto.randomUUID(),rows,notes:notesText(notes),preview:preview.fingerprint,status:'PREPARED',hadUnknown:false};saveAttempt(attempt,storage);return attempt;
}
const rejectedCodes=new Set(['LITE2_EPOCH_BUSY','LITE2_EPOCH_PREVIEW_CHANGED','LITE1_MODE_REQUIRES_QUIESCENCE','LITE2_EPOCH_RESERVATIONS_EXIST','LITE2_EPOCH_INACTIVE_STOCK_REVIEW','LITE2_EPOCH_GO_LIVE_NOT_FINISHED','LITE2_OWNER_AAL2_REQUIRED','LITE1_MODE_DISABLED']);
/** Same saved body/key/fingerprint on recovery,including after mode is ON.
 * There is one mutation,never an automatic retry or a new identity. */
export async function runOpeningEpochAttemptWithClient(client:EpochClient,actorId:string,storage:EpochStorage){
 let attempt=readOpeningEpochAttempt(actorId,storage);if(!attempt||attempt.status==='DEFINITIVELY_REJECTED')throw epochInvalid();if(attempt.status==='SUCCEEDED')return attempt.result!;
 await identity(client,actorId);const current=readOpeningEpochAttempt(actorId,storage);if(JSON.stringify(current)!==JSON.stringify(attempt))throw epochInvalid();
 attempt={...attempt,status:'IN_FLIGHT',hadUnknown:attempt.hadUnknown||['IN_FLIGHT','OUTCOME_UNKNOWN'].includes(attempt.status)};saveAttempt(attempt,storage);
 try{
  const response=await client.rpc('lite1_activate_epoch2',{p_rows:attempt.rows,p_notes:attempt.notes,p_key:attempt.key,p_preview:attempt.preview,p_confirmation:'تفعيل المحاسبة بالجرد المعتمد'});
  if(response.error){const code=response.error.message?.match(/^([A-Z][A-Z0-9_]+)(?::|$)/u)?.[1];if(response.error.code==='P0001'&&code&&rejectedCodes.has(code)&&!attempt.hadUnknown){saveAttempt({...attempt,status:'DEFINITIVELY_REJECTED'},storage);throw epochInvalid();}throw epochInvalid();}
  const done=result(response.data,attempt.rows);await identity(client,actorId);saveAttempt({...attempt,status:'SUCCEEDED',result:done},storage);return done;
 }catch{const latest=readOpeningEpochAttempt(actorId,storage);if(latest?.key===attempt.key&&latest.status!=='DEFINITIVELY_REJECTED'&&latest.status!=='SUCCEEDED')saveAttempt({...attempt,status:'OUTCOME_UNKNOWN',hadUnknown:true},storage);throw epochInvalid();}
}
function db():EpochClient {if(!isSupabaseConfigured||!supabase)throw epochInvalid();return supabase;}
export const readEpochCatalog=(actorId:string)=>readEpochCatalogWithClient(db(),actorId);
export const previewOpeningEpoch=(actorId:string,rows:readonly EpochRow[],notes:string)=>previewOpeningEpochWithClient(db(),actorId,rows,notes);
export async function activateOpeningEpoch(actorId:string,preview:EpochPreview,notes:string,storage:EpochStorage,replaceResolved=false){return withAdminActionLock(openingEpochJournalKey(actorId),async()=>{prepareOpeningEpochAttempt(actorId,preview,notes,storage,replaceResolved);return runOpeningEpochAttemptWithClient(db(),actorId,storage);});}
export async function recoverOpeningEpoch(actorId:string,storage:EpochStorage){return withAdminActionLock(openingEpochJournalKey(actorId),()=>runOpeningEpochAttemptWithClient(db(),actorId,storage));}
