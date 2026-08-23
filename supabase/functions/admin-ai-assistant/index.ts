import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

type DashboardPayload = {
  summary?: Record<string, unknown>;
  stockAlerts?: Array<Record<string, unknown>>;
  orderStatuses?: Array<Record<string, unknown>>;
  sevenDaySales?: Array<Record<string, unknown>>;
};

type InventorySnapshotPayload = {
  items?: Array<Record<string, unknown>>;
};

type InventoryItem = {
  productName: string;
  sku: string;
  saleUnitName: string;
  unitsPerSaleUnit: number;
  availableBaseUnits: number;
  availableSalePackages: number;
};

type InventoryMatch = InventoryItem & { score: number };

type AssistantContext =
  | 'monitoring'
  | 'inventory'
  | 'debts'
  | 'monthly_report'
  | 'orders'
  | 'daily_summary'
  | 'profit';

type MonthlyReport = {
  periodLabel: string;
  branchCount: number;
  sales: {
    orderCount: number;
    grossSalesInMinorUnits: number;
    netSalesInMinorUnits: number;
    netProfitInMinorUnits: number;
    collectedInMinorUnits: number;
    outstandingInMinorUnits: number;
  };
  expenses: { count: number; totalInMinorUnits: number };
  purchases: { receiptCount: number; totalInMinorUnits: number };
  balances: {
    customerDueInMinorUnits: number;
    supplierDueInMinorUnits: number;
  };
  inventory: { stockedProducts: number; lowStockProducts: number };
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const formatJod = (valueInMinorUnits: unknown) =>
  `${asJod(valueInMinorUnits).toFixed(3)} د.أ`;

const normalizeForMatch = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/[؟،؛]/g, ' ')
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ')
    .trim();

const searchStopWords = new Set([
  'هل', 'هو', 'هي', 'في', 'من', 'عندكم', 'عندي', 'كم', 'موجود', 'موجوده',
  'متوفر', 'متوفره', 'المتوفر', 'المخزون', 'رصيد', 'الصنف', 'منتج', 'المنتج',
  'الحبه', 'حبه', 'قطعه', 'قطعة', 'كرتونه', 'كرتونة', 'طرد', 'stock',
  'inventory', 'available', 'have', 'how', 'many', 'the', 'is', 'are',
]);

const searchTokens = (value: string) =>
  normalizeForMatch(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !searchStopWords.has(token));

// Treat a harmless repeated Latin letter as a typo: "watter" -> "water".
// Arabic letters are intentionally left untouched because doubling can change meaning.
const collapseRepeatedLatinLetters = (value: string) => value.replace(/([a-z])\1+/g, '$1');

const levenshteinDistance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const current = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = current;
    }
  }
  return previous[right.length];
};

const mapInventoryItems = (
  payload: InventorySnapshotPayload | InventorySnapshotPayload[] | null | undefined,
): InventoryItem[] => {
  // PostgREST normally returns a JSONB RPC result as an object. Accept a one-row
  // response too, so a platform serialization change cannot make every product
  // lookup silently fall back to the language model.
  const normalizedPayload = Array.isArray(payload) ? payload[0] : payload;

  return (Array.isArray(normalizedPayload?.items) ? normalizedPayload.items : []).map((item) => ({
    productName: String(item.productName ?? ''),
    sku: String(item.sku ?? ''),
    saleUnitName: String(item.saleUnitName ?? 'طرد'),
    unitsPerSaleUnit: Math.max(1, asCount(item.unitsPerSaleUnit)),
    availableBaseUnits: asCount(item.availableBaseUnits),
    availableSalePackages: asCount(item.availableSalePackages),
  })).filter((item) => item.productName.length > 0 || item.sku.length > 0);
};

const mapDashboardStockAlerts = (dashboard: DashboardPayload): InventoryItem[] =>
  mapInventoryItems({
    items: (dashboard.stockAlerts || []).map((alert) => ({
      productName: alert.nameAr ?? alert.productName,
      sku: alert.sku,
      saleUnitName: alert.saleUnitName,
      unitsPerSaleUnit: alert.unitsPerSaleUnit,
      availableBaseUnits: alert.availableBaseUnits,
      availableSalePackages: alert.availableSalePackages,
    })),
  });

const findInventoryMatches = (message: string, items: InventoryItem[]): InventoryMatch[] => {
  const queryTokens = searchTokens(message);
  if (queryTokens.length === 0) return [];

  return items.map((item) => {
    const candidateText = normalizeForMatch(item.productName + ' ' + item.sku);
    const candidateTokens = searchTokens(item.productName + ' ' + item.sku);
    let score = 0;

    for (const queryToken of queryTokens) {
      const compactQueryToken = collapseRepeatedLatinLetters(queryToken);
      if (candidateTokens.some((candidateToken) =>
        candidateToken === queryToken ||
        collapseRepeatedLatinLetters(candidateToken) === compactQueryToken
      )) {
        score = Math.max(score, 100);
        continue;
      }
      if (candidateText.includes(queryToken) && queryToken.length >= 3) {
        score = Math.max(score, 88);
        continue;
      }
      if (queryToken.length >= 4) {
        for (const candidateToken of candidateTokens) {
          if (candidateToken.length < 4) continue;
          const distance = levenshteinDistance(queryToken, candidateToken);
          if (distance <= Math.max(1, Math.floor(Math.max(queryToken.length, candidateToken.length) / 4))) {
            score = Math.max(score, 80);
          }
        }
      }
    }
    return { ...item, score };
  }).filter((item) => item.score >= 80)
    .sort((left, right) => right.score - left.score || left.productName.localeCompare(right.productName, 'ar'))
    .slice(0, 5);
};

const isInventoryQuestion = (message: string) =>
  /(موجود|متوفر|مخزون|رصيد|كم|باقي|بقي|available|stock|inventory|how many)/i.test(message);

const isPriorityMonitoringQuestion = (message: string) =>
  /((اهم|أهم).{0,20}(امور|أمور|اشياء|أشياء).{0,28}(متابعة|تحتاج))|((متابعة|تحتاج).{0,28}(اهم|أهم).{0,20}(امور|أمور|اشياء|أشياء))|what needs attention|priority items/i.test(message);

const isAmbiguousFollowUpQuestion = (message: string) => {
  const normalized = normalizeForMatch(message).replace(/\s+/g, ' ');
  return new Set([
    'ما هي',
    'ماهي',
    'شو هي',
    'اشو هي',
    'وضح',
    'وضحلي',
    'اذكرها',
    'اذكرهم',
    'فصلها',
    'افصلها',
    'التفاصيل',
  ]).has(normalized);
};

const isDebtQuestion = (message: string) =>
  /(ذمم|ذمه|مديون|مستحقات العملاء|مستحقات الموردين|على العملاء|على الموردين|receivable|payable|debt)/i.test(message);

const isMonthlyReportQuestion = (message: string) =>
  /((تقرير|ملخص|اداء|أداء|مبيعات|مصروفات|مشتريات|ارباح|أرباح).{0,24}(شهري|الشهر))|((شهري|الشهر).{0,24}(تقرير|ملخص|اداء|أداء|مبيعات|مصروفات|مشتريات|ارباح|أرباح))|monthly/i.test(message);

const isOrderStatusQuestion = (message: string) =>
  /(وضع الطلبات|حالة الطلبات|طلبات جديدة|طلبات جديده|قيد التجهيز|جاهز للتوصيل|بالتوصيل|طلبات اليوم|طلبات مفتوحة|طلبات مفتوحه|order status|open orders)/i.test(message);

const isDailySummaryQuestion = (message: string) =>
  /(ملخص.*اليوم|اليوم.*ملخص|اداء.*اليوم|أداء.*اليوم|مبيعات اليوم|شو وضع اليوم|وضع اليوم|today sales|daily summary)/i.test(message);

const isProfitQuestion = (message: string) =>
  /(الربح|ارباح|أرباح|صافي الربح|profit)/i.test(message);

const formatInventoryQuantity = (item: InventoryItem) => {
  if (item.availableBaseUnits <= 0) return 'غير متوفر حاليًا';
  if (item.unitsPerSaleUnit <= 1) {
    return `${item.availableBaseUnits} ${item.saleUnitName}`;
  }

  const packages = Math.floor(item.availableBaseUnits / item.unitsPerSaleUnit);
  const remainder = item.availableBaseUnits % item.unitsPerSaleUnit;
  const packageText = `${packages} ${item.saleUnitName}`;
  return remainder > 0 ? `${packageText} و${remainder} حبة/قطعة` : packageText;
};

const buildDirectInventoryAnswer = (matches: InventoryMatch[]) => {
  if (matches.length === 1) {
    const item = matches[0];
    return `«${item.productName || item.sku}» ${item.availableBaseUnits > 0 ? 'موجود' : 'غير متوفر'} الآن. المتاح: ${formatInventoryQuantity(item)} (${item.availableBaseUnits} حبة/قطعة أساسية).`;
  }

  return `وجدت أكثر من صنف مطابق. ${matches.map((item) =>
    `«${item.productName || item.sku}»: ${formatInventoryQuantity(item)}`,
  ).join('، ')}.`;
};

const statusLabel = (status: string) => ({
  new: 'جديدة',
  confirmed: 'مؤكدة',
  preparing: 'قيد التجهيز',
  ready: 'جاهزة للتوصيل',
  out_for_delivery: 'بالتوصيل',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
}[status] || status || 'غير محددة');

const buildDirectDebtAnswer = (dashboard: DashboardPayload) => {
  const summary = dashboard.summary || {};
  const customerDue = summary.customerReceivablesInMinorUnits ?? summary.receivables ?? 0;
  const supplierDue = summary.supplierPayablesInMinorUnits ?? summary.payables ?? 0;
  const customerText = asJod(customerDue) > 0
    ? `ذمم العملاء: ${formatJod(customerDue)}.`
    : 'لا توجد ذمم مستحقة على العملاء حاليًا.';
  const supplierText = asJod(supplierDue) > 0
    ? `التزامات الموردين: ${formatJod(supplierDue)}.`
    : 'لا توجد التزامات مستحقة للموردين حاليًا.';
  return `${customerText} ${supplierText} الأرقام إجمالية ولا تعرض بيانات العملاء داخل المحادثة.`;
};

const buildDirectOrderStatusAnswer = (dashboard: DashboardPayload) => {
  const summary = dashboard.summary || {};
  const statuses = (dashboard.orderStatuses || [])
    .map((item) => {
      const count = asCount(item.count ?? item.total);
      return count > 0 ? `${statusLabel(String(item.status ?? item.code ?? ''))}: ${count}` : '';
    })
    .filter(Boolean);
  const intro = `الطلبات المفتوحة: ${asCount(summary.openOrdersCount)}، والطلبات الجديدة: ${asCount(summary.newOrdersCount)}.`;
  return statuses.length > 0
    ? `${intro} التوزيع الحالي: ${statuses.join('، ')}.`
    : `${intro} لا توجد حالات طلبات إضافية تحتاج متابعة الآن.`;
};

const buildDirectDailySummary = (dashboard: DashboardPayload) => {
  const summary = dashboard.summary || {};
  const profit = summary.monthProfitInMinorUnits;
  const profitText = profit === null || profit === undefined
    ? ''
    : ` صافي ربح الشهر حتى الآن: ${formatJod(profit)}.`;
  return `ملخص اليوم: مبيعات مكتملة ${formatJod(summary.todaySalesInMinorUnits ?? summary.salesToday ?? 0)} من ${asCount(summary.todayCompletedOrders ?? summary.ordersToday)} طلب/فاتورة. الطلبات الجديدة: ${asCount(summary.newOrdersCount)}، والمفتوحة: ${asCount(summary.openOrdersCount)}. تنبيه المخزون: ${asCount(summary.lowStockCount)} منخفض و${asCount(summary.outOfStockCount)} نافد.${profitText}`;
};

const buildDirectMonitoringAnswer = (dashboard: DashboardPayload) => {
  const summary = dashboard.summary || {};
  const actions: string[] = [];
  const newOrders = asCount(summary.newOrdersCount);
  const openOrders = asCount(summary.openOrdersCount);
  const lowStock = asCount(summary.lowStockCount);
  const outOfStock = asCount(summary.outOfStockCount);
  const configurationIssues = asCount(summary.configurationIssuesCount);
  const customerDue = summary.customerReceivablesInMinorUnits ?? summary.receivables ?? 0;
  const supplierDue = summary.supplierPayablesInMinorUnits ?? summary.payables ?? 0;

  if (newOrders > 0) actions.push(`راجع ${newOrders} طلب جديد`);
  if (openOrders > 0) actions.push(`أكمل متابعة ${openOrders} طلب مفتوح`);
  if (outOfStock > 0) actions.push(`عالج ${outOfStock} صنف نافد من المخزون`);
  if (lowStock > 0) actions.push(`تابع ${lowStock} صنفًا منخفض المخزون`);
  if (asJod(customerDue) > 0) actions.push(`راجع ذمم العملاء بقيمة ${formatJod(customerDue)}`);
  if (asJod(supplierDue) > 0) actions.push(`راجع التزامات الموردين بقيمة ${formatJod(supplierDue)}`);
  if (configurationIssues > 0) actions.push(`أكمل ضبط ${configurationIssues} إعدادات/أصناف تحتاج تهيئة`);

  return actions.length > 0
    ? `أهم الأمور التي تحتاج متابعة الآن: ${actions.map((item, index) => `${index + 1}) ${item}`).join('، ')}.`
    : 'لا توجد أمور عاجلة ظاهرة الآن: لا طلبات جديدة أو مفتوحة، ولا تنبيهات مخزون أو ذمم أو إعدادات معلقة.';
};

const assistantContexts = new Set<AssistantContext>([
  'monitoring',
  'inventory',
  'debts',
  'monthly_report',
  'orders',
  'daily_summary',
  'profit',
]);

const asAssistantContext = (value: unknown): AssistantContext | undefined =>
  typeof value === 'string' && assistantContexts.has(value as AssistantContext)
    ? value as AssistantContext
    : undefined;

const mapMonthlyReport = (payload: unknown): MonthlyReport | null => {
  const root = asRecord(payload);
  if (root.success !== true) return null;
  const period = asRecord(root.period);
  const sales = asRecord(root.sales);
  const expenses = asRecord(root.expenses);
  const purchases = asRecord(root.purchases);
  const balances = asRecord(root.balances);
  const inventory = asRecord(root.inventory);
  return {
    periodLabel: String(period.label ?? ''),
    branchCount: asCount(root.branchCount),
    sales: {
      orderCount: asCount(sales.orderCount),
      grossSalesInMinorUnits: Number(sales.grossSalesInMinorUnits ?? 0),
      netSalesInMinorUnits: Number(sales.netSalesInMinorUnits ?? 0),
      netProfitInMinorUnits: Number(sales.netProfitInMinorUnits ?? 0),
      collectedInMinorUnits: Number(sales.collectedInMinorUnits ?? 0),
      outstandingInMinorUnits: Number(sales.outstandingInMinorUnits ?? 0),
    },
    expenses: {
      count: asCount(expenses.count),
      totalInMinorUnits: Number(expenses.totalInMinorUnits ?? 0),
    },
    purchases: {
      receiptCount: asCount(purchases.receiptCount),
      totalInMinorUnits: Number(purchases.totalInMinorUnits ?? 0),
    },
    balances: {
      customerDueInMinorUnits: Number(balances.customerDueInMinorUnits ?? 0),
      supplierDueInMinorUnits: Number(balances.supplierDueInMinorUnits ?? 0),
    },
    inventory: {
      stockedProducts: asCount(inventory.stockedProducts),
      lowStockProducts: asCount(inventory.lowStockProducts),
    },
  };
};

const buildDirectMonthlyReportAnswer = (report: MonthlyReport) => {
  const scope = report.branchCount > 1 ? `من ${report.branchCount} فروع نشطة` : 'للفرع النشط';
  return `تقرير ${report.periodLabel || 'الشهر الحالي'} ${scope}: المبيعات الصافية ${formatJod(report.sales.netSalesInMinorUnits)} من ${report.sales.orderCount} طلب/فاتورة، وصافي الربح ${formatJod(report.sales.netProfitInMinorUnits)}. المقبوض ${formatJod(report.sales.collectedInMinorUnits)}، ومصروفات التشغيل ${formatJod(report.expenses.totalInMinorUnits)} (${report.expenses.count} قيد)، والمشتريات ${formatJod(report.purchases.totalInMinorUnits)} (${report.purchases.receiptCount} سند). ذمم العملاء الحالية ${formatJod(report.balances.customerDueInMinorUnits)}، والتزامات الموردين الحالية ${formatJod(report.balances.supplierDueInMinorUnits)}. المخزون: ${report.inventory.stockedProducts} صنفًا متوفرًا و${report.inventory.lowStockProducts} يحتاج متابعة.`;
};

// Deliberately excludes latest orders and every customer identity, address, or phone field.
const buildSafeSnapshot = (dashboard: DashboardPayload, inventoryMatches: InventoryMatch[]) => {
  const summary = dashboard.summary || {};
  return {
    generatedAt: new Date().toISOString(),
    currency: 'JOD',
    summary: {
      salesToday: asJod(
        summary.todaySalesInMinorUnits ?? summary.salesToday ?? summary.todaySales,
      ),
      salesThisMonth: asJod(
        summary.monthSalesInMinorUnits ?? summary.salesThisMonth ?? summary.monthSales,
      ),
      receivables: asJod(
        summary.customerReceivablesInMinorUnits ?? summary.receivables ?? summary.customerReceivables,
      ),
      payables: asJod(
        summary.supplierPayablesInMinorUnits ?? summary.payables ?? summary.supplierPayables,
      ),
      netProfitThisMonth: asJod(
        summary.monthProfitInMinorUnits ?? summary.netProfitThisMonth ?? summary.monthProfit,
      ),
      ordersToday: asCount(summary.todayCompletedOrders ?? summary.ordersToday),
      activeProducts: asCount(summary.activeProductsCount),
      lowStockProducts: asCount(summary.lowStockCount),
      outOfStockProducts: asCount(summary.outOfStockCount),
    },
    orderStatuses: (dashboard.orderStatuses || []).slice(0, 8).map((status) => ({
      status: String(status.status ?? status.code ?? ''),
      label: String(status.label ?? status.statusLabel ?? ''),
      count: asCount(status.count ?? status.total),
    })),
    stockAlerts: (dashboard.stockAlerts || []).slice(0, 12).map((alert) => ({
      productName: String(alert.productName ?? alert.nameAr ?? alert.name ?? ''),
      sku: String(alert.sku ?? ''),
      severity: String(alert.severity ?? alert.status ?? ''),
      availablePackages: asCount(
        alert.availableSalePackages ?? alert.availablePackages ?? alert.available ?? alert.quantity,
      ),
    })),
    inventoryMatches: inventoryMatches.map(({ score: _score, ...item }) => item),
    sevenDaySales: (dashboard.sevenDaySales || []).slice(-7).map((day) => ({
      date: String(day.date ?? ''),
      sales: asJod(day.salesInMinorUnits ?? day.sales ?? day.totalSales ?? day.amount),
    })),
  };
};

const systemInstruction = 'أنت مساعد إداري عربي لنظام نواصرة للجملة. أجب بالعربية فقط وباختصار مفيد. ' +
  'المعلومات المعطاة لك هي ملخص تشغيلي مجهول الهوية. لا تطلب أو تخمّن بيانات شخصية، ولا تذكر عملاء أو أرقام هواتف أو عناوين. ' +
  'لا تدّعِ تنفيذ أي إجراء: أنت للقراءة والتحليل فقط ولا يمكنك تعديل الطلبات أو المخزون أو الحسابات. ' +
  'اعتمد فقط على الملخص المرفق. عند وجود inventoryMatches استخدم الكمية والاسم كما هما ولا تقل إن الصنف غير موجود. ' +
  'availableSalePackages هي الطرود الكاملة المتاحة وavailableBaseUnits هي عدد الحبات/القطع الأساسية. ' +
  'إن كان السؤال قصيراً ومبهماً ولا تتوفر له بيانات كافية، اطلب من المستخدم تحديد هل يقصد المخزون أو الطلبات أو الذمم أو التقارير، ولا تخمّن المقصود. ' +
  'إن لم تتوفر معلومة، قل بوضوح إنها غير متاحة حالياً. ' +
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

  let body: { message?: unknown; context?: unknown };
  try {
    body = await request.json();
  } catch {
    return respond({ error: 'صيغة الطلب غير صحيحة.' }, 400, origin);
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const followUpContext = asAssistantContext(body.context);
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

  const { data: inventorySnapshot, error: inventoryError } = await caller.rpc(
    'get_admin_ai_inventory_snapshot',
  );
  if (inventoryError) {
    console.error('get_admin_ai_inventory_snapshot failed', inventoryError.code);
    return respond({ error: 'تعذر تحميل مخزون الأصناف الحالي.' }, 500, origin);
  }

  const inventoryMatches = findInventoryMatches(
    message,
    mapInventoryItems(inventorySnapshot as InventorySnapshotPayload | InventorySnapshotPayload[]),
  );
  if (isInventoryQuestion(message) && inventoryMatches.length > 0) {
    return respond({ answer: buildDirectInventoryAnswer(inventoryMatches), context: 'inventory' }, 200, origin);
  }

  const { data: dashboard, error: dashboardError } = await caller.rpc('get_home_dashboard');
  if (dashboardError) {
    console.error('get_home_dashboard failed', dashboardError.code);
    return respond({ error: 'تعذر تحميل ملخص العمل الحالي.' }, 500, origin);
  }

  const dashboardPayload = (dashboard || {}) as DashboardPayload;
  const dashboardInventoryMatches = findInventoryMatches(
    message,
    mapDashboardStockAlerts(dashboardPayload),
  );
  if (isInventoryQuestion(message) && dashboardInventoryMatches.length > 0) {
    return respond({ answer: buildDirectInventoryAnswer(dashboardInventoryMatches), context: 'inventory' }, 200, origin);
  }

  // These are business facts, not language-model interpretations. Answer the
  // common financial and operational questions directly from guarded RPC data.
  if (isDebtQuestion(message)) {
    return respond({ answer: buildDirectDebtAnswer(dashboardPayload), context: 'debts' }, 200, origin);
  }
  if (isMonthlyReportQuestion(message)) {
    const { data: monthlyReport, error: monthlyReportError } = await caller.rpc(
      'get_admin_ai_monthly_report',
    );
    if (monthlyReportError) {
      console.error('get_admin_ai_monthly_report failed', monthlyReportError.code);
      return respond({ error: 'تعذر إنشاء التقرير الشهري من قاعدة البيانات.' }, 500, origin);
    }
    const mappedMonthlyReport = mapMonthlyReport(monthlyReport);
    if (!mappedMonthlyReport) {
      return respond({ error: 'أعاد التقرير الشهري بيانات غير صالحة.' }, 500, origin);
    }
    return respond({ answer: buildDirectMonthlyReportAnswer(mappedMonthlyReport), context: 'monthly_report' }, 200, origin);
  }
  if (isOrderStatusQuestion(message)) {
    return respond({ answer: buildDirectOrderStatusAnswer(dashboardPayload), context: 'orders' }, 200, origin);
  }
  if (isDailySummaryQuestion(message)) {
    return respond({ answer: buildDirectDailySummary(dashboardPayload), context: 'daily_summary' }, 200, origin);
  }
  if (isProfitQuestion(message)) {
    const summary = dashboardPayload.summary || {};
    const profit = summary.monthProfitInMinorUnits ?? summary.netProfitThisMonth;
    if (profit !== null && profit !== undefined) {
      return respond(
        {
          answer: `صافي ربح الشهر حتى الآن: ${formatJod(profit)}. للمبيعات التفصيلية والمصروفات اسأل: «أعطني التقرير الشهري».`,
          context: 'profit',
        },
        200,
        origin,
      );
    }
  }
  if (isPriorityMonitoringQuestion(message)) {
    return respond({ answer: buildDirectMonitoringAnswer(dashboardPayload), context: 'monitoring' }, 200, origin);
  }
  if (isAmbiguousFollowUpQuestion(message)) {
    // A short question such as "ما هي؟" has no subject by itself. The browser
    // can pass only a safe topic token, and monitoring is the useful default
    // if the message was opened fresh without prior context.
    if (followUpContext === 'debts') {
      return respond({ answer: buildDirectDebtAnswer(dashboardPayload), context: 'debts' }, 200, origin);
    }
    if (followUpContext === 'orders') {
      return respond({ answer: buildDirectOrderStatusAnswer(dashboardPayload), context: 'orders' }, 200, origin);
    }
    if (followUpContext === 'daily_summary') {
      return respond({ answer: buildDirectDailySummary(dashboardPayload), context: 'daily_summary' }, 200, origin);
    }
    if (followUpContext === 'profit') {
      const summary = dashboardPayload.summary || {};
      const profit = summary.monthProfitInMinorUnits ?? summary.netProfitThisMonth;
      if (profit !== null && profit !== undefined) {
        return respond({ answer: `صافي ربح الشهر حتى الآن: ${formatJod(profit)}.`, context: 'profit' }, 200, origin);
      }
    }
    if (followUpContext === 'inventory') {
      return respond({ answer: 'اكتب اسم المنتج أو SKU لأعطيك الكمية المتاحة بدقة.', context: 'inventory' }, 200, origin);
    }
    return respond({ answer: buildDirectMonitoringAnswer(dashboardPayload), context: 'monitoring' }, 200, origin);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return respond(
      { error: 'المساعد غير مفعّل بعد. أضف مفتاح Gemini الآمن إلى أسرار Supabase.' },
      503,
      origin,
    );
  }

  const safeSnapshot = buildSafeSnapshot(
    dashboardPayload,
    inventoryMatches,
  );
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
