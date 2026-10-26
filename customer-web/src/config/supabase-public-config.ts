/** Selected at build time. Missing context never falls back to a hosted DB. */
declare const __NAWASRAH_PUBLIC_CONFIG__: {SUPABASE_URL:string;SUPABASE_PUBLISHABLE_KEY:string;TURNSTILE_SITE_KEY:string};
export const SUPABASE_PUBLIC_CONFIG = typeof __NAWASRAH_PUBLIC_CONFIG__ === 'undefined'
  ? {SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',TURNSTILE_SITE_KEY:''}
  : __NAWASRAH_PUBLIC_CONFIG__;
