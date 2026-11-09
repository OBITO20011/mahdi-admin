import type {SupabaseClient} from '@supabase/supabase-js';

/** Statuses never loop back. The same actor/order/target has one stable key;
 * changing notes after losing a reply cannot start a second transition. */
export async function transitionLiteOrder(client:SupabaseClient,orderId:string,next:string,notes?:string){
 if(!['confirmed','preparing','ready','out_for_delivery'].includes(next))throw Error('لا تستخدم تغيير الحالة لتسوية أو إلغاء الطلب.');
 const actor=await client.auth.getUser();if(actor.error||!actor.data.user?.id)throw Error('تعذر التحقق من المستخدم.');
 const identity=JSON.stringify([actor.data.user.id,orderId,next]);
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
 const key='lite2-transition:'+Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
 return client.rpc('lite1_transition2',{p_order:orderId,p_next:next,p_key:key,p_notes:notes||null});
}
