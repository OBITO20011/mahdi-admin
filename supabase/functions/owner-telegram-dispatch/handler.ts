import {formatOwnerMessage, ownerInlineKeyboard, ownerTestMessage, type OwnerEvent} from '../_shared/owner-telegram-format.ts';

type Json = Record<string, unknown>;
export type DispatchConfig = {
  secret?: string; enabled?: string; testEnabled?: string;
  botToken?: string; ownerChatId?: string;
};
export type DispatchClient = {rpc(name:string, args:Json):Promise<{data:unknown;error:unknown}>};
export type DispatchDependencies = {
  config:DispatchConfig;
  createClient:()=>DispatchClient;
  fetch:typeof fetch;
  uuid:()=>string;
};
const response=(code:string,status=200,more:Json={})=>new Response(JSON.stringify({code,...more}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const safeEqual=(a:string,b:string)=>{
  if(a.length!==b.length)return false;
  let different=0;for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);
  return different===0;
};
const record=(v:unknown):v is Json=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

// Never include a thrown error, HTTP body, URL, recipient or token in diagnostics.
// One network request per event: retries and dead-letter belong to the DB contract.
export function ownerTelegramHandler(deps:DispatchDependencies) {
  return async(request:Request):Promise<Response>=>{
    const {config}=deps;
    if(request.method!=='POST')return response('OWNER_TELEGRAM_POST_REQUIRED',405);
    if(!config.secret||config.secret.length<32)return response('OWNER_TELEGRAM_NOT_CONFIGURED',503);
    if(!safeEqual(request.headers.get('x-owner-telegram-secret')??'',config.secret))return response('OWNER_TELEGRAM_UNAUTHORIZED',401);
    let body:unknown;
    try {if(Number(request.headers.get('content-length')??0)>512)return response('OWNER_TELEGRAM_INVALID_REQUEST',400);body=await request.json();}
    catch{return response('OWNER_TELEGRAM_INVALID_REQUEST',400);}
    if(!record(body)||!['dispatch','test'].includes(String(body.mode)))return response('OWNER_TELEGRAM_INVALID_REQUEST',400);
    const test=body.mode==='test';
    if(test?config.testEnabled!=='true'||body.testConsent!==true:config.enabled!=='true')return response('OWNER_TELEGRAM_DISABLED');
    if(!config.botToken||!/^\d+:[A-Za-z0-9_-]{20,}$/.test(config.botToken)||!config.ownerChatId||! /^[1-9]\d{0,19}$/.test(config.ownerChatId))return response('OWNER_TELEGRAM_NOT_CONFIGURED',503);
    const send=async(text:string,keyboard:ReturnType<typeof ownerInlineKeyboard>):Promise<boolean>=>{
      try{
        const sent=await deps.fetch('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{
          method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(4000),
          body:JSON.stringify({chat_id:config.ownerChatId,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:keyboard}),
        });
        if(!sent.ok)return false;
        // Telegram private chat ids are at most52 significant bits. Reject any
        // unsafe numeric echo rather than accepting a rounded recipient identity.
        const result:unknown=await sent.json();
        if(!record(result)||result.ok!==true||!record(result.result))return false;
        const receipt=result.result,chat=receipt.chat;
        return Number.isSafeInteger(receipt.message_id)&&Number(receipt.message_id)>0&&record(chat)
          &&((typeof chat.id==='number'&&Number.isSafeInteger(chat.id))||typeof chat.id==='string')
          &&String(chat.id)===config.ownerChatId;
      }catch{return false;}
    };
    if(test){const delivered=await send(ownerTestMessage,{inline_keyboard:[]});return response(delivered?'OWNER_TELEGRAM_TEST_DELIVERED':'OWNER_TELEGRAM_DELIVERY_FAILED',delivered?200:502,{testDelivered:delivered});}
    let client:DispatchClient;
    try{client=deps.createClient();}catch{return response('OWNER_TELEGRAM_CLIENT_FAILED',503);}
    const runId=deps.uuid();let acquired=false;
    const rpc=async(name:string,args:Json)=>{
      try{const result=await client.rpc(name,args);return result.error?null:result.data;}catch{return null;}
    };
    try{
      const claim=await rpc('claim_owner_telegram_deliveries_v1',{p_run_id:runId});
      if(!record(claim))return response('OWNER_TELEGRAM_CLAIM_FAILED',503);
      if(claim.code==='OWNER_TELEGRAM_DISABLED'||claim.code==='OWNER_TELEGRAM_BUSY')return response(claim.code);
      if(claim.success!==true||!Array.isArray(claim.items)||claim.items.length>3)return response('OWNER_TELEGRAM_CLAIM_FAILED',503);
      acquired=true;
      let delivered=0,failed=0;
      for(const item of claim.items){
        if(!record(item)||!uuid(item.eventId))return response('OWNER_TELEGRAM_INVALID_CLAIM',503);
        let success=false,error:string|null=null;
        try{
          const event:OwnerEvent={eventType:typeof item.eventType==='string'?item.eventType:'',entityId:typeof item.entityId==='string'?item.entityId:undefined,payload:record(item.payload)?item.payload:{}};
          const text=formatOwnerMessage(event),keyboard=ownerInlineKeyboard(event);
          // Revalidate after formatting/before EACH external side effect. A
          // suspended/expired invocation cannot send on another run's lease.
          if(await rpc('owner_telegram_dispatch_lease_valid_v1',{p_run_id:runId})!==true)return response('OWNER_TELEGRAM_LEASE_LOST',409);
          success=await send(text,keyboard);if(!success)error='OWNER_TELEGRAM_DELIVERY_FAILED';
        }catch{error='OWNER_BUSINESS_EVENT_NOT_ALLOWED';}
        const complete=await rpc('complete_owner_telegram_delivery_v1',{p_run_id:runId,p_event_id:item.eventId,p_success:success,p_error:error});
        if(!record(complete)||complete.success!==true)return response('OWNER_TELEGRAM_COMPLETE_FAILED',503);
        if(success)delivered++;else failed++;
      }
      return response('OWNER_TELEGRAM_BATCH_COMPLETE',200,{delivered,failed});
    }catch{return response('OWNER_TELEGRAM_OPERATION_FAILED',503);}
    finally{if(acquired)await rpc('release_owner_telegram_dispatch_v1',{p_run_id:runId});}
  };
}
