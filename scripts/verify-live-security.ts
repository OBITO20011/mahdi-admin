import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLIC_CONFIG } from '../src/config/supabase-public-config';

const client = createClient(
  SUPABASE_PUBLIC_CONFIG.SUPABASE_URL,
  SUPABASE_PUBLIC_CONFIG.SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function expectPublicRpc(functionName: string) {
  const { error } = await client.rpc(functionName);
  if (error) {
    throw new Error(`${functionName} should be public but returned ${error.code}: ${error.message}`);
  }
  console.log(`PASS public RPC: ${functionName}`);
}

async function expectAnonymousRpcDenied(functionName: string) {
  const { error } = await client.rpc(functionName);
  if (!error) {
    throw new Error(`${functionName} unexpectedly allowed anonymous execution`);
  }

  const denied =
    error.code === '42501' ||
    error.code === 'PGRST301' ||
    /permission denied|not authenticated|unauthorized/i.test(error.message);

  if (!denied) {
    throw new Error(`${functionName} failed for an unexpected reason ${error.code}: ${error.message}`);
  }
  console.log(`PASS anonymous denied: ${functionName}`);
}

await expectPublicRpc('get_public_storefront_settings');
await expectPublicRpc('get_public_storefront_offers');
await expectAnonymousRpcDenied('get_dashboard_analytics');
await expectAnonymousRpcDenied('is_mfa_policy_satisfied');

console.log('Live Supabase public/admin security boundaries verified.');

