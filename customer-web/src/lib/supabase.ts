import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLIC_CONFIG } from '../config/supabase-public-config';

const viteEnvironment: Record<string, string | undefined> =
  (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env ?? {};

const supabaseUrl =
  viteEnvironment.VITE_SUPABASE_URL?.trim() ||
  SUPABASE_PUBLIC_CONFIG.SUPABASE_URL.trim();
const supabasePublishableKey =
  (
    viteEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY ||
    viteEnvironment.VITE_SUPABASE_ANON_KEY ||
    SUPABASE_PUBLIC_CONFIG.SUPABASE_PUBLISHABLE_KEY
  )?.trim() || '';

export const isSupabaseConfigured = Boolean(
  /^https:\/\/.+\.supabase\.co\/?$/.test(supabaseUrl) &&
    supabasePublishableKey.length > 10
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl.replace(/\/+$/, ''), supabasePublishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
