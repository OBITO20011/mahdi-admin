import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

type DashboardPayload = {
  summary?: Record<string, unknown>;
  stockAlerts?: Array<Record<string, unknown>>;
  orderStatuses?: Array<Record<string, unknown>>;
  sevenDaySales?: Array<Record<string, unknown>>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

const allowedOrigins = new Set([
  'https://nawasrah-admin.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
]);

const isAllowedOrigin = (origin: string | null) =>
  !origin ||
  allowedOrigins.has(origin) ||
  /^https:\/\/[a-z0-9-]+\.nawasrah-admin\.pages\.dev$/i.test(origin);

const corsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': isAllowedOrigin(origin)
    ? origin || 'https://nawasrah-admin.pages.dev'
    : 'https://nawasrah-admin.pages.dev',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});

const respond = (body: Record<string, unknown>, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

const asJod = (value: unknown) => {
  const minor = Number(value);
  return Number.isFinite(minor) ? Number((minor / 1000).toFixed(3)) : 0;
};

const asCount = (value: unknown) => {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
};

// Deliberately excludes latest orders and every customer identity, address, or phone field.
const buildSafeSnapshot = (dashboard: DashboardPayload) => {
  const summary = dashboard.summary || {};
  return {
    generatedAt: new Date().toISOString(),
    currency: 'JOD',
    summary: {
      salesToday: asJod(summary.salesToday ?? summary.todaySales ?? summary.totalSalesToday),
      salesThisMonth: asJod(summary.salesThisMonth ?? summary.monthSales),
      receivables: asJod(summary.receivables ?? summary.customerReceivables),
      payables: asJod(summary.payables ?? summary.supplierPayables),
      cashBalance: asJod(summary.cashBalance),
      cliqBalance: asJod(summary.cliqBalance),
      netProfitToday: asJod(summary.netProfitToday ?? summary.profitToday),
      ordersToday: asCount(summary.ordersToday),
    },
    orderStatuses: (dashboard.orderStatuses || []).slice(0, 8).map((status) => ({
      status: String(status.status ?? status.code ?? ''),
      label: String(status.label ?? status.statusLabel ?? ''),
      count: asCount(status.count ?? status.total),
    })),
    stockAlerts: (dashboard.stockAlerts || []).slice(0, 12).map((alert) => ({
      productName: String(alert.productName ?? alert.name ?? ''),
      sku: String(alert.sku ?? ''),
      severity: String(alert.severity ?? alert.status ?? ''),
      availablePackages: asCount(alert.availablePackages ?? alert.available ?? alert.quantity),
      reorderLevel: asCount(alert.reorderLevel ?? alert.minimumQuantity),
    })),
    sevenDaySales: (dashboard.sevenDaySales || []).slice(-7).map((day) => ({
      date: String(day.date ?? ''),
      sales: asJod(day.sales ?? day.totalSales ?? day.amount),
      orders: asCount(day.orders ?? day.count),
    })),
  };
};

const systemInstruction = 'أنت مساعد إداري عربي لنظام نواصرة للجملة. أجب بالعربية فقط وباختصار مفيد. ' +
  'المعلومات المعطاة لك هي ملخص تشغيلي مجهول الهوية. لا تطلب أو تخمّن بيانات شخصية، ولا تذكر عملاء أو أرقام هواتف أو عناوين. ' +
  'لا تدّعِ تنفيذ أي إجراء: أنت للقراءة والتحليل فقط ولا يمكنك تعديل الطلبات أو المخزون أو الحسابات. ' +
  'اعتمد فقط على الملخص المرفق. إن لم تتوفر معلومة، قل بوضوح إنها غير متاحة حالياً. ' +
  'اكتب الأرقام بالدينار الأردني عند الحاجة، وقدّم تنبيهات عملية قصيرة قابلة للتنفيذ داخل لوحة الإدارة.';

const configuredModel = () => {
  const candidate = Deno.env.get('GEMINI_MODEL')?.trim();
  return candidate && /^[a-z0-9._-]+$/i.test(candidate)
    ? candidate
    : 'gemini-3.6-flash';
};

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (!isAllowedOrigin(origin)) return respond({ error: 'المصدر غير مسموح.' }, 403, origin);
  if (request.method !== 'POST') return respond({ error: 'الطريقة غير مدعومة.' }, 405, origin);

  const authorization = request.headers.get('authorization') || '';
  const accessToken = authorization.replace(/^Bearer\s+/i, '').trim();
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!accessToken || !supabaseUrl || !publishableKey) {
    return respond({ error: 'تعذر التحقق من جلسة الدخول.' }, 401, origin);
  }

  let body: { message?: unknown };
  try {
    body = await request.json();
  } catch {
    return respond({ error: 'صيغة الطلب غير صحيحة.' }, 400, origin);
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > 750) {
    return respond({ error: 'اكتب سؤالاً بين 1 و750 حرفاً.' }, 400, origin);
  }

  const caller = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: 'Bearer ' + accessToken } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return respond({ error: 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.' }, 401, origin);
  }

  const { error: authorizationError } = await caller.rpc('authorize_admin_ai_assistant_request');
  if (authorizationError) {
    const isRateLimited = authorizationError.code === '42901';
    return respond(
      { error: isRateLimited ? 'تم بلوغ الحد المؤقت للمساعد. حاول بعد بضع دقائق.' : 'لا تملك صلاحية استخدام المساعد.' },
      isRateLimited ? 429 : 403,
      origin,
    );
  }

  const { data: dashboard, error: dashboardError } = await caller.rpc('get_home_dashboard');
  if (dashboardError) {
    console.error('get_home_dashboard failed', dashboardError.code);
    return respond({ error: 'تعذر تحميل ملخص العمل الحالي.' }, 500, origin);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return respond(
      { error: 'المساعد غير مفعّل بعد. أضف مفتاح Gemini الآمن إلى أسرار Supabase.' },
      503,
      origin,
    );
  }

  const safeSnapshot = buildSafeSnapshot((dashboard || {}) as DashboardPayload);
  const geminiResponse = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + configuredModel() + ':generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{
          role: 'user',
          parts: [{
            text: 'سؤال المستخدم:\n' + message + '\n\nملخص العمل الحقيقي الحالي (لا يحتوي بيانات شخصية):\n' + JSON.stringify(safeSnapshot),
          }],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 450 },
      }),
    },
  );
  if (!geminiResponse.ok) {
    console.error('Gemini request failed', geminiResponse.status);
    return respond({ error: 'تعذر الحصول على إجابة الآن. حاول لاحقاً.' }, 502, origin);
  }

  const geminiPayload = (await geminiResponse.json()) as GeminiResponse;
  const answer = geminiPayload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!answer) {
    return respond({ error: 'لم يتم إنشاء إجابة قابلة للعرض. حاول صياغة السؤال بشكل آخر.' }, 502, origin);
  }
  return respond({ answer }, 200, origin);
});
