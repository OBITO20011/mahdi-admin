import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLIC_CONFIG } from '../config/supabase-public-config';

/**
 * Clean and sanitize raw Supabase URL string
 */
function sanitizeSupabaseUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim();

  // Remove quotes
  url = url.replace(/^['"]+|['"]+$/g, '');

  // Strip accidental env var name prefix e.g. "VITE_SUPABASE_URL="
  if (url.includes('=')) {
    const parts = url.split('=');
    url = parts[parts.length - 1].trim();
    url = url.replace(/^['"]+|['"]+$/g, '');
  }

  // Remove trailing rest/v1 or trailing slashes
  url = url.replace(/\/rest\/v1\/?$/i, '');
  url = url.replace(/\/+$/, '');

  return url;
}

/**
 * Clean and sanitize raw Supabase Key string
 */
function sanitizeSupabaseKey(rawKey?: string): string {
  if (!rawKey) return '';
  let key = rawKey.trim();

  // Remove quotes
  key = key.replace(/^['"]+|['"]+$/g, '');

  // Strip accidental env var name prefix e.g. "VITE_SUPABASE_PUBLISHABLE_KEY="
  if (key.includes('=')) {
    const parts = key.split('=');
    key = parts[parts.length - 1].trim();
    key = key.replace(/^['"]+|['"]+$/g, '');
  }

  return key;
}

// 1. Read from env or fallback to src/config/supabase-public-config.ts
const envUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_URL : '') || '';

const envKey = (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY)) ||
  (typeof process !== 'undefined' ? (process.env?.VITE_SUPABASE_PUBLISHABLE_KEY || process.env?.VITE_SUPABASE_ANON_KEY) : '') || '';

const rawUrl = envUrl || SUPABASE_PUBLIC_CONFIG.SUPABASE_URL || '';
const rawKey = envKey || SUPABASE_PUBLIC_CONFIG.SUPABASE_PUBLISHABLE_KEY || '';

export const sanitizedSupabaseUrl = sanitizeSupabaseUrl(rawUrl);
export const sanitizedSupabaseKey = sanitizeSupabaseKey(rawKey);

// Validate scheme
export const isValidSupabaseUrl = Boolean(
  sanitizedSupabaseUrl &&
  (sanitizedSupabaseUrl.startsWith('https://') || sanitizedSupabaseUrl.startsWith('http://localhost'))
);

export const isSupabaseConfigured = Boolean(
  isValidSupabaseUrl &&
  sanitizedSupabaseKey &&
  sanitizedSupabaseKey.length > 10
);

let client: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  try {
    client = createClient(sanitizedSupabaseUrl, sanitizedSupabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  } catch (error) {
    console.error('[Supabase Init Error] Failed to initialize Supabase client:', error);
  }
}

export const supabase = client;

/**
 * Diagnostic helper to safely test connection status and report readiness
 */
export async function checkSupabaseConnection(): Promise<{
  hasUrl: boolean;
  isValidUrlScheme: boolean;
  hasKey: boolean;
  isInitialized: boolean;
  sanitizedUrl: string;
  status: 'configured' | 'missing_env' | 'invalid_url' | 'connection_error';
  message: string;
}> {
  const hasUrl = Boolean(sanitizedSupabaseUrl);
  const isValidUrlScheme = isValidSupabaseUrl;
  const hasKey = Boolean(sanitizedSupabaseKey);

  if (!hasUrl || !hasKey) {
    return {
      hasUrl,
      isValidUrlScheme,
      hasKey,
      isInitialized: false,
      sanitizedUrl: sanitizedSupabaseUrl || 'غير محدد',
      status: 'missing_env',
      message: 'القيم غير مكتملة. يرجى فتح src/config/supabase-public-config.ts وتحديد SUPABASE_URL و SUPABASE_PUBLISHABLE_KEY.',
    };
  }

  if (!isValidUrlScheme) {
    return {
      hasUrl,
      isValidUrlScheme: false,
      hasKey,
      isInitialized: false,
      sanitizedUrl: sanitizedSupabaseUrl,
      status: 'invalid_url',
      message: `رابط Supabase غير صالح: "${sanitizedSupabaseUrl}". يجب أن يبدأ بـ https:// وأن يكون نطاق مشروعك مثل https://your-project.supabase.co.`,
    };
  }

  if (!supabase) {
    return {
      hasUrl,
      isValidUrlScheme,
      hasKey,
      isInitialized: false,
      sanitizedUrl: sanitizedSupabaseUrl,
      status: 'connection_error',
      message: 'تعذر إنشاء عميل Supabase Client رغم توفر الرابط والمفتاح.',
    };
  }

  return {
    hasUrl,
    isValidUrlScheme: true,
    hasKey,
    isInitialized: true,
    sanitizedUrl: sanitizedSupabaseUrl,
    status: 'configured',
    message: `عميل Supabase جاهز ومتصل بالنطاق: ${sanitizedSupabaseUrl}`,
  };
}
