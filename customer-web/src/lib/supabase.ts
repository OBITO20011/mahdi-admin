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

const normalizedSupabaseUrl = supabaseUrl.replace(/\/+$/, '');

export const isSupabaseConfigured = Boolean(
  /^https:\/\/.+\.supabase\.co\/?$/.test(supabaseUrl) &&
    supabasePublishableKey.length > 10
);

export const supabase = isSupabaseConfigured
  ? createClient(normalizedSupabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;

interface EdgeFunctionErrorPayload {
  error?: unknown;
  code?: unknown;
}

export class PublicGatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly outcomeUnknown: boolean
  ) {
    super(message);
    this.name = 'PublicGatewayError';
  }
}

export async function invokePublicEdgeFunction<T>(
  functionName: string,
  body: unknown
): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }

  let response: Response;
  try {
    response = await fetch(
      `${normalizedSupabaseUrl}/functions/v1/${functionName}`,
      {
        method: 'POST',
        headers: {
          apikey: supabasePublishableKey,
          'Content-Type': 'application/json',
          'X-Client-Info': 'nawasrah-customer-web',
        },
        body: JSON.stringify(body),
      }
    );
  } catch {
    throw new PublicGatewayError(
      'انقطع الاتصال بعد إرسال الطلب. حالة الطلب غير معروفة؛ أعد التحقق بنفس المحاولة.',
      'network_outcome_unknown',
      0,
      true
    );
  }

  let payload: T | EdgeFunctionErrorPayload;
  try {
    payload = (await response.json()) as T | EdgeFunctionErrorPayload;
  } catch {
    throw new PublicGatewayError(
      'وصل رد غير مكتمل. حالة الطلب غير معروفة؛ أعد التحقق بنفس المحاولة.',
      'invalid_gateway_response',
      response.status,
      true
    );
  }

  if (!response.ok) {
    const errorValue = (payload as EdgeFunctionErrorPayload).error;
    const safeMessage = typeof errorValue === 'string'
      ? errorValue
      : 'تعذر إرسال الطلب مؤقتًا. حاول مرة أخرى.';
    const codeValue = (payload as EdgeFunctionErrorPayload).code;
    const code = typeof codeValue === 'string' ? codeValue : 'gateway_error';
    throw new PublicGatewayError(
      safeMessage,
      code,
      response.status,
      response.status >= 500 || response.status === 429
    );
  }

  return payload as T;
}
