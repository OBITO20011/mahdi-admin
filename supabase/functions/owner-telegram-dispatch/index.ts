import {createClient} from 'npm:@supabase/supabase-js@2.110.8';
import {ownerTelegramHandler} from './handler.ts';

Deno.serve(ownerTelegramHandler({
  config:{
    secret:Deno.env.get('OWNER_TELEGRAM_DISPATCH_SECRET'),
    enabled:Deno.env.get('OWNER_TELEGRAM_ENABLED'),
    testEnabled:Deno.env.get('OWNER_TELEGRAM_TEST_ENABLED'),
    botToken:Deno.env.get('OWNER_TELEGRAM_BOT_TOKEN'),
    ownerChatId:Deno.env.get('OWNER_TELEGRAM_CHAT_ID'),
    developerChatIdForComparison:Deno.env.get('OWNER_TELEGRAM_DEVELOPER_CHAT_ID_FOR_COMPARISON'),
  },
  createClient:()=>createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})},
  }),
  fetch,
  uuid:()=>crypto.randomUUID(),
}));
