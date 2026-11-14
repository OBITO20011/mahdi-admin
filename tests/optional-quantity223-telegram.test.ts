import test from 'node:test';
import assert from 'node:assert/strict';
import {formatOwnerMessage,ownerInlineKeyboard} from '../supabase/functions/_shared/owner-telegram-format';
import {ownerTelegramHandler} from '../supabase/functions/owner-telegram-dispatch/handler';
const id='92600000-0000-4000-8000-000000000103';
const payload={quantitySource:'sales_only_counter',accountingTracked:false,audience:'owner',productId:id,productName:'<صنف وهمي>',sku:'TEST-COUNTER',availableQuantity:1,thresholdQuantity:2,unitName:'باكيت'};
test('optional counter owner messages escape input,use actual units and keep accounting stock messages unchanged',()=>{
 for(const eventType of ['low_stock','out_of_stock']){
  const event={eventType,payload},message=formatOwnerMessage(event);
  assert.match(message,/&lt;صنف وهمي&gt;/u);assert.match(message,/1 باكيت/u);assert.match(message,/عدّاد الكمية الاختياري/u);assert.doesNotMatch(message,/المستودع|تكلفة|ربح|مورد/u);
  assert.deepEqual(ownerInlineKeyboard(event),{inline_keyboard:[[{text:'افتح الإدارة',url:'https://admin.alnawasreh.com/'}]]});
  const full=formatOwnerMessage({eventType,payload:{...payload,accountingTracked:true,warehouseName:'مستودع الاختبار'}});assert.match(full,/المستودع: مستودع الاختبار/u);
 }
});
test('counter event goes through real217 handler with local-only stub and the configured owner recipient',async()=>{
 const sent:Record<string,unknown>[]=[],completed:Record<string,unknown>[]=[],secret='local-counter-dispatch-fixture-only',chat='811111111';
 const handler=ownerTelegramHandler({config:{enabled:'true',secret,botToken:'123456:'+Array(4).fill('SYNTHETIC_').join(''),ownerChatId:chat,developerChatIdForComparison:'-922222222'},uuid:()=>id,
  createClient:()=>({rpc:async(name,args)=>{
   if(name==='complete_owner_telegram_delivery_v1')completed.push(args);
   return {error:null,data:name==='claim_owner_telegram_deliveries_v1'?{success:true,items:[{eventId:id,entityId:id,eventType:'low_stock',payload}]}:name==='owner_telegram_dispatch_lease_valid_v1'?true:{success:true}};
  }}),
  fetch:async(_url,options)=>{sent.push(JSON.parse(String(options?.body)) as Record<string,unknown>);return Response.json({ok:true,result:{message_id:1,chat:{id:chat}}});},
 });
 const result=await handler(new Request('http://127.0.0.1/owner-telegram-dispatch',{method:'POST',headers:{'x-owner-telegram-secret':secret,'Content-Type':'application/json'},body:JSON.stringify({mode:'dispatch'})}));
 assert.equal((await result.json()).delivered,1);assert.equal(sent.length,1);assert.equal(sent[0].chat_id,chat);assert.equal(completed.length,1);assert.equal(completed[0].p_success,true);
});
