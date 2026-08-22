/**
 * Nawasrah Business Manager - Supabase Public Configuration
 * 
 * ضع رابط مشروع Supabase ومفتاح العميل (Publishable / Anon Key) هنا مباشرة
 * لضمان الاتصال المستقر في بيئة AI Studio Preview دون الاعتماد على متغيرات البيئة المعزولة.
 * 
 * ملاحظة أمان: هذا المكان مخصص للمفاتيح العامة (Anon / Publishable) فقط.
 * لا تضع مفتاح المسؤول أو السر (service_role / secret key) هنا على الإطلاق.
 */

export const SUPABASE_PUBLIC_CONFIG = {
  // مثال: 'https://xyzcompany.supabase.co'
  SUPABASE_URL: 'https://acjtabdqqnpwhdvbvnyw.supabase.co',

  // مثال: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_XYq8HBYT6Pxa2VdRdi69CA_012vvfp5',

  // Public key used only to render Cloudflare Turnstile on admin login.
  TURNSTILE_SITE_KEY: '0x4AAAAAAEPJTplD4PVe_Cgk',
};
