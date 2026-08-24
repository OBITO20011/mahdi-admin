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
  salePriceInMinorUnits: number;
  availableBaseUnits: number;
  availableSalePackages: number;
};

type InventoryMatch = InventoryItem & { score: number };

type DashboardStockAlert = InventoryItem & {
  severity: 'configuration' | 'out_of_stock' | 'low_stock' | string;
};

type AssistantContext =
  | 'monitoring'
  | 'inventory'
  | 'weekly_summary'
  | 'debts'
  | 'monthly_report'
  | 'orders'
  | 'daily_summary'
  | 'profit';

type AssistantCardTone = 'info' | 'success' | 'warning' | 'danger';

type AssistantFactTone = 'default' | 'positive' | 'warning' | 'danger';

type AssistantCard = {
  title: string;
  subtitle?: string;
  tone: AssistantCardTone;
  facts?: Array<{ label: string; value: string; tone?: AssistantFactTone }>;
  note?: string;
  suggestions?: string[];
};

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

const asMinorUnits = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0;
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
    salePriceInMinorUnits: asMinorUnits(item.salePriceInMinorUnits),
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
      salePriceInMinorUnits: alert.salePriceInMinorUnits,
      availableBaseUnits: alert.availableBaseUnits,
      availableSalePackages: alert.availableSalePackages,
    })),
  });

const getDashboardStockAlerts = (dashboard: DashboardPayload): DashboardStockAlert[] =>
  (dashboard.stockAlerts || []).map((alert) => ({
    productName: String(alert.nameAr ?? alert.productName ?? alert.name ?? ''),
    sku: String(alert.sku ?? ''),
    saleUnitName: String(alert.saleUnitName ?? 'طرد'),
    unitsPerSaleUnit: Math.max(1, asCount(alert.unitsPerSaleUnit)),
    salePriceInMinorUnits: asMinorUnits(alert.salePriceInMinorUnits),
    availableBaseUnits: asCount(alert.availableBaseUnits),
    availableSalePackages: asCount(alert.availableSalePackages),
    severity: String(alert.severity ?? 'low_stock'),
  })).filter((alert) => alert.productName.length > 0 || alert.sku.length > 0);

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

const isAvailabilityQuestion = (message: string) =>
  /(موجود|متوفر|مخزون|رصيد|باقي|بقي|available|stock|inventory|how many)/i.test(message);

const isInventoryAlertQuestion = (message: string) =>
  /((اصناف|أصناف|المخزون).{0,28}(تحتاج|تدخل|تدخلا|تدخّل|ناقص|منخفض|نافد|نفاذ))|((ناقص|منخفض|نافد|نفاذ).{0,28}(اصناف|أصناف|مخزون))|stock alerts|low stock|out of stock/i.test(message);

const isProductPriceQuestion = (message: string) =>
  /(سعر|بكم|بيعها|بتبيعها|للبيع|price|how much)/i.test(message);

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

const isGreetingMessage = (message: string) => new Set([
  'مرحبا', 'مرحبا بك', 'اهلا', 'اهلا بك', 'اهلين', 'اهلين فيك',
  'السلام عليكم', 'السلام عليكم ورحمة الله', 'صباح الخير', 'مساء الخير',
  'هاي', 'hello', 'hi',
]).has(normalizeForMatch(message).replace(/\s+/g, ' '));

const isHelpQuestion = (message: string) =>
  /(شو بتقدر|ماذا تستطيع|شو بتعمل|كيف تساعد|ساعدني|كيف استخدمك|وظيفتك|اوامرك|أوامرك|help|what can you do)/i.test(message);

const isDebtQuestion = (message: string) =>
  /(ذمم|ذمه|مديون|مستحقات العملاء|مستحقات الموردين|على العملاء|على الموردين|receivable|payable|debt)/i.test(message);

const isMonthlyReportQuestion = (message: string) =>
  /((تقرير|ملخص|اداء|أداء|مبيعات|مصروفات|مشتريات|ارباح|أرباح).{0,24}(شهري|الشهر))|((شهري|الشهر).{0,24}(تقرير|ملخص|اداء|أداء|مبيعات|مصروفات|مشتريات|ارباح|أرباح))|monthly/i.test(message);

const isOrderStatusQuestion = (message: string) =>
  /(وضع الطلبات|حالة الطلبات|طلبات جديدة|طلبات جديده|قيد التجهيز|جاهز للتوصيل|بالتوصيل|طلبات اليوم|طلبات مفتوحة|طلبات مفتوحه|order status|open orders)/i.test(message);

const isDailySummaryQuestion = (message: string) =>
  /(ملخص.*اليوم|اليوم.*ملخص|اداء.*اليوم|أداء.*اليوم|مبيعات اليوم|شو وضع اليوم|وضع اليوم|today sales|daily summary)/i.test(message);

const isWeeklySummaryQuestion = (message: string) =>
  /((ملخص|تقرير|مبيعات|اداء|أداء).{0,24}(اسبوع|أسبوع))|((اسبوع|أسبوع).{0,24}(ملخص|تقرير|مبيعات|اداء|أداء))|weekly/i.test(message);

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
    const name = `«${item.productName || item.sku}»`;
    if (item.availableSalePackages > 0) {
      const contents = item.unitsPerSaleUnit > 1
        ? ` (${item.unitsPerSaleUnit} حبة/قطعة في ${item.saleUnitName})`
        : '';
      return `${name}: متوفر للبيع — ${formatInventoryQuantity(item)}${contents}.`;
    }
    if (item.availableBaseUnits > 0) {
      return `${name}: لا يوجد ${item.saleUnitName} كامل للبيع؛ المتبقي ${item.availableBaseUnits} حبة/قطعة.`;
    }
    return `${name}: غير متوفر حاليًا.`;
  }

  return `وجدت أكثر من صنف مطابق. ${matches.map((item) =>
    `«${item.productName || item.sku}»: ${formatInventoryQuantity(item)}`,
  ).join('، ')}.`;
};

const buildDirectProductPriceAnswer = (item: InventoryItem) => {
  const name = `«${item.productName || item.sku}»`;
  if (item.salePriceInMinorUnits <= 0) {
    return `${name}: لم يُضبط سعر بيع ${item.saleUnitName} بعد.`;
  }
  const stockNote = item.availableSalePackages > 0 ? '' : ' الصنف غير متوفر للبيع الآن.';
  return `${name}: سعر البيع ${formatJod(item.salePriceInMinorUnits)} لكل ${item.saleUnitName}.${stockNote}`;
};

const findInventoryItemBySku = (sku: string | undefined, items: InventoryItem[]) =>
  sku ? items.find((item) => item.sku === sku) : undefined;

const buildProductClarificationAnswer = () =>
  'اكتب اسم المنتج أو SKU، مثل: «كم سعر water للبيع؟»';

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
  return asJod(customerDue) > 0 || asJod(supplierDue) > 0
    ? 'ملخص الذمم الإجمالي ظاهر في البطاقة، دون عرض أي بيانات شخصية.'
    : 'لا توجد ذمم معلقة حاليًا.';
};

const buildDirectOrderStatusAnswer = (dashboard: DashboardPayload) => {
  const summary = dashboard.summary || {};
  const hasOpenOrders = asCount(summary.openOrdersCount) > 0 || asCount(summary.newOrdersCount) > 0;
  return hasOpenOrders
    ? 'تفصيل الطلبات التي تحتاج متابعة ظاهر في البطاقة.'
    : 'لا توجد طلبات مفتوحة تحتاج متابعة الآن.';
};

const buildDirectDailySummary = (dashboard: DashboardPayload) => {
  void dashboard;
  return 'ملخص المبيعات والطلبات وتنبيهات المخزون لليوم ظاهر في البطاقة.';
};

const buildDirectWeeklySummary = (dashboard: DashboardPayload) => {
  const sales = (dashboard.sevenDaySales || []).map((day) => ({
    date: String(day.date ?? ''),
    amount: asMinorUnits(day.salesInMinorUnits ?? day.sales ?? day.totalSales ?? day.amount),
  }));
  if (sales.length === 0) {
    return 'لا توجد بيانات مبيعات كافية لملخص الأسبوع الحالي بعد.';
  }

  return `ملخص آخر ${sales.length} أيام ظاهر في البطاقة.`;
};

const describeStockAlert = (alert: DashboardStockAlert) => {
  const name = `«${alert.productName || alert.sku}»`;
  if (alert.severity === 'configuration') {
    return `${name}: يحتاج ضبط وحدة البيع أو سعر الطرد`;
  }
  if (alert.severity === 'out_of_stock') {
    return alert.availableBaseUnits > 0
      ? `${name}: لا يوجد ${alert.saleUnitName} كامل للبيع (المتبقي ${alert.availableBaseUnits} حبة/قطعة)`
      : `${name}: نافد بالكامل`;
  }
  return `${name}: المتاح ${formatInventoryQuantity(alert)}`;
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
  const stockAlerts = getDashboardStockAlerts(dashboard);
  const outOfStockAlerts = stockAlerts.filter((alert) => alert.severity === 'out_of_stock');
  const lowStockAlerts = stockAlerts.filter((alert) => alert.severity === 'low_stock');
  const configurationAlerts = stockAlerts.filter((alert) => alert.severity === 'configuration');

  if (newOrders > 0) actions.push(`راجع ${newOrders} طلب جديد`);
  if (openOrders > 0) actions.push(`أكمل متابعة ${openOrders} طلب مفتوح`);
  if (outOfStockAlerts.length > 0) {
    actions.push(`المخزون غير الجاهز للبيع: ${outOfStockAlerts.map(describeStockAlert).join('، ')}`);
  } else if (outOfStock > 0) {
    actions.push(`عالج ${outOfStock} صنف نافد من المخزون`);
  }
  if (lowStockAlerts.length > 0) {
    actions.push(`المخزون المنخفض: ${lowStockAlerts.map(describeStockAlert).join('، ')}`);
  } else if (lowStock > 0) {
    actions.push(`تابع ${lowStock} صنفًا منخفض المخزون`);
  }
  if (asJod(customerDue) > 0) actions.push(`راجع ذمم العملاء بقيمة ${formatJod(customerDue)}`);
  if (asJod(supplierDue) > 0) actions.push(`راجع التزامات الموردين بقيمة ${formatJod(supplierDue)}`);
  if (configurationAlerts.length > 0) {
    actions.push(`أصناف تحتاج تهيئة: ${configurationAlerts.map(describeStockAlert).join('، ')}`);
  } else if (configurationIssues > 0) {
    actions.push(`أكمل ضبط ${configurationIssues} إعدادات/أصناف تحتاج تهيئة`);
  }

  return actions.length > 0
    ? 'رتّب الأولوية من البطاقة: الطلبات أولًا، ثم المخزون، ثم الذمم.'
    : 'لا توجد أمور عاجلة ظاهرة الآن.';
};

const assistantContexts = new Set<AssistantContext>([
  'monitoring',
  'inventory',
  'weekly_summary',
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
  return `تفاصيل تقرير ${report.periodLabel || 'الشهر الحالي'} ظاهرة في البطاقة.`;
};

const productAvailabilityTone = (item: InventoryItem): AssistantCardTone => {
  if (item.availableSalePackages > 0) return 'success';
  return item.availableBaseUnits > 0 ? 'warning' : 'danger';
};

const productAvailabilityLabel = (item: InventoryItem) => {
  if (item.availableSalePackages > 0) return 'متوفر للبيع';
  return item.availableBaseUnits > 0 ? 'لا يوجد طرد كامل للبيع' : 'غير متوفر حاليًا';
};

const buildInventoryCard = (matches: InventoryMatch[]): AssistantCard => {
  if (matches.length === 1) {
    const item = matches[0];
    return {
      title: item.productName || item.sku,
      subtitle: productAvailabilityLabel(item),
      tone: productAvailabilityTone(item),
      facts: [
        {
          label: 'المتاح للبيع',
          value: formatInventoryQuantity(item),
          tone: item.availableSalePackages > 0 ? 'positive' : item.availableBaseUnits > 0 ? 'warning' : 'danger',
        },
        { label: 'وحدة البيع', value: item.saleUnitName },
        ...(item.unitsPerSaleUnit > 1
          ? [{ label: 'محتوى الطرد', value: `${item.unitsPerSaleUnit} حبة/قطعة` }]
          : []),
      ],
      suggestions: [
        `كم سعر ${item.productName || item.sku} للبيع؟`,
        'ما هي أصناف المخزون الناقص؟',
      ],
    };
  }

  return {
    title: 'نتائج مطابقة متعددة',
    subtitle: 'حدد اسم الصنف أو SKU إذا كنت تقصد صنفًا بعينه',
    tone: 'info',
    facts: matches.slice(0, 4).map((item) => ({
      label: item.productName || item.sku,
      value: formatInventoryQuantity(item),
      tone: item.availableSalePackages > 0 ? 'positive' : 'warning',
    })),
  };
};

const buildProductPriceCard = (item: InventoryItem): AssistantCard => ({
  title: `سعر بيع ${item.productName || item.sku}`,
  subtitle: item.salePriceInMinorUnits > 0 ? 'سعر الطرد الكامل للعميل' : 'سعر البيع يحتاج ضبطًا',
  tone: item.salePriceInMinorUnits > 0 ? 'info' : 'warning',
  facts: [
    {
      label: 'سعر البيع',
      value: item.salePriceInMinorUnits > 0 ? formatJod(item.salePriceInMinorUnits) : 'غير مضبوط',
      tone: item.salePriceInMinorUnits > 0 ? 'positive' : 'warning',
    },
    { label: 'وحدة البيع', value: item.saleUnitName },
    ...(item.unitsPerSaleUnit > 1
      ? [{ label: 'محتوى الطرد', value: `${item.unitsPerSaleUnit} حبة/قطعة` }]
      : []),
    {
      label: 'حالة التوفر',
      value: productAvailabilityLabel(item),
      tone: item.availableSalePackages > 0 ? 'positive' : item.availableBaseUnits > 0 ? 'warning' : 'danger',
    },
  ],
  suggestions: [`هل ${item.productName || item.sku} موجود؟`, 'ما أهم الأمور التي تحتاج متابعة الآن؟'],
});

const buildDebtCard = (dashboard: DashboardPayload): AssistantCard => {
  const summary = dashboard.summary || {};
  const customerDue = summary.customerReceivablesInMinorUnits ?? summary.receivables ?? 0;
  const supplierDue = summary.supplierPayablesInMinorUnits ?? summary.payables ?? 0;
  const hasDue = asJod(customerDue) > 0 || asJod(supplierDue) > 0;
  return {
    title: 'الذمم الحالية',
    subtitle: hasDue ? 'إجماليات مالية دون بيانات شخصية' : 'لا توجد ذمم معلقة حاليًا',
    tone: hasDue ? 'warning' : 'success',
    facts: [
      {
        label: 'على العملاء',
        value: formatJod(customerDue),
        tone: asJod(customerDue) > 0 ? 'warning' : 'positive',
      },
      {
        label: 'للموردين',
        value: formatJod(supplierDue),
        tone: asJod(supplierDue) > 0 ? 'warning' : 'positive',
      },
    ],
    suggestions: ['أعطني التقرير الشهري الحالي.', 'ما أهم الأمور التي تحتاج متابعة الآن؟'],
  };
};

const buildOrdersCard = (dashboard: DashboardPayload): AssistantCard => {
  const summary = dashboard.summary || {};
  const facts = [
    { label: 'طلبات جديدة', value: String(asCount(summary.newOrdersCount)), tone: asCount(summary.newOrdersCount) > 0 ? 'warning' : 'positive' as AssistantFactTone },
    { label: 'طلبات مفتوحة', value: String(asCount(summary.openOrdersCount)), tone: asCount(summary.openOrdersCount) > 0 ? 'warning' : 'positive' as AssistantFactTone },
    ...(dashboard.orderStatuses || []).map((item) => ({
      label: statusLabel(String(item.status ?? item.code ?? '')),
      value: String(asCount(item.count ?? item.total)),
      tone: 'default' as AssistantFactTone,
    })).filter((item) => item.value !== '0'),
  ].slice(0, 6);
  const requiresAttention = asCount(summary.newOrdersCount) > 0 || asCount(summary.openOrdersCount) > 0;
  return {
    title: 'حالة الطلبات',
    subtitle: requiresAttention ? 'هناك طلبات تحتاج متابعة' : 'لا توجد طلبات مفتوحة الآن',
    tone: requiresAttention ? 'warning' : 'success',
    facts,
    suggestions: ['أعطني ملخصاً مختصراً لأداء اليوم.', 'ما أهم الأمور التي تحتاج متابعة الآن؟'],
  };
};

const buildDailyCard = (dashboard: DashboardPayload): AssistantCard => {
  const summary = dashboard.summary || {};
  const lowStock = asCount(summary.lowStockCount);
  const outOfStock = asCount(summary.outOfStockCount);
  const requiresAttention = asCount(summary.newOrdersCount) > 0 || outOfStock > 0;
  return {
    title: 'أداء اليوم',
    subtitle: 'ملخص تشغيلي مباشر للفرع الحالي',
    tone: requiresAttention ? 'warning' : 'info',
    facts: [
      { label: 'المبيعات المكتملة', value: formatJod(summary.todaySalesInMinorUnits ?? summary.salesToday ?? 0), tone: 'positive' },
      { label: 'طلبات/فواتير مكتملة', value: String(asCount(summary.todayCompletedOrders ?? summary.ordersToday)) },
      { label: 'طلبات جديدة', value: String(asCount(summary.newOrdersCount)), tone: asCount(summary.newOrdersCount) > 0 ? 'warning' : 'positive' },
      { label: 'مخزون منخفض', value: String(lowStock), tone: lowStock > 0 ? 'warning' : 'positive' },
      { label: 'مخزون نافد', value: String(outOfStock), tone: outOfStock > 0 ? 'danger' : 'positive' },
    ],
    suggestions: ['أعطني ملخص الأسبوع.', 'ما وضع الذمم الحالية؟'],
  };
};

const buildWeeklyCard = (dashboard: DashboardPayload): AssistantCard => {
  const sales = (dashboard.sevenDaySales || []).map((day) => ({
    date: String(day.date ?? ''),
    amount: asMinorUnits(day.salesInMinorUnits ?? day.sales ?? day.totalSales ?? day.amount),
  }));
  const total = sales.reduce((sum, day) => sum + day.amount, 0);
  const bestDay = sales.length > 0
    ? sales.reduce((best, day) => day.amount > best.amount ? day : best, sales[0])
    : undefined;
  return {
    title: `ملخص آخر ${sales.length || 7} أيام`,
    subtitle: sales.length > 0 ? 'المبيعات المكتملة فقط' : 'لا توجد مبيعات مكتملة مسجلة في هذه الفترة',
    tone: sales.length > 0 ? 'info' : 'warning',
    facts: [
      { label: 'إجمالي المبيعات', value: formatJod(total), tone: 'positive' },
      ...(bestDay ? [{ label: 'أعلى يوم', value: `${bestDay.date || '—'} · ${formatJod(bestDay.amount)}` }] : []),
    ],
    suggestions: ['أعطني التقرير الشهري الحالي.', 'ما أهم الأمور التي تحتاج متابعة الآن؟'],
  };
};

const buildMonitoringCard = (dashboard: DashboardPayload): AssistantCard => {
  const summary = dashboard.summary || {};
  const lowStock = asCount(summary.lowStockCount);
  const outOfStock = asCount(summary.outOfStockCount);
  const configurationIssues = asCount(summary.configurationIssuesCount);
  const newOrders = asCount(summary.newOrdersCount);
  const openOrders = asCount(summary.openOrdersCount);
  const customerDue = summary.customerReceivablesInMinorUnits ?? summary.receivables ?? 0;
  const needsAttention = newOrders > 0 || openOrders > 0 || lowStock > 0 || outOfStock > 0 || asJod(customerDue) > 0 || configurationIssues > 0;
  const stockNames = getDashboardStockAlerts(dashboard)
    .filter((item) => item.severity === 'out_of_stock' || item.severity === 'low_stock')
    .slice(0, 2)
    .map(describeStockAlert);
  return {
    title: needsAttention ? 'متابعة اليوم' : 'الوضع التشغيلي مستقر',
    subtitle: needsAttention ? 'ابدأ بالعناصر ذات اللون التحذيري' : 'لا توجد عناصر عاجلة ظاهرة',
    tone: needsAttention ? (outOfStock > 0 ? 'danger' : 'warning') : 'success',
    facts: [
      { label: 'طلبات جديدة', value: String(newOrders), tone: newOrders > 0 ? 'warning' : 'positive' },
      { label: 'طلبات مفتوحة', value: String(openOrders), tone: openOrders > 0 ? 'warning' : 'positive' },
      { label: 'مخزون منخفض', value: String(lowStock), tone: lowStock > 0 ? 'warning' : 'positive' },
      { label: 'مخزون نافد', value: String(outOfStock), tone: outOfStock > 0 ? 'danger' : 'positive' },
      { label: 'ذمم العملاء', value: formatJod(customerDue), tone: asJod(customerDue) > 0 ? 'warning' : 'positive' },
      ...(configurationIssues > 0 ? [{ label: 'يحتاج تهيئة', value: String(configurationIssues), tone: 'warning' as AssistantFactTone }] : []),
    ].slice(0, 6),
    ...(stockNames.length > 0 ? { note: `الأكثر إلحاحًا: ${stockNames.join('، ')}.` } : {}),
    suggestions: ['ما هي أصناف المخزون التي تحتاج تدخلاً؟', 'ما وضع الذمم الحالية؟', 'ما هي حالة الطلبات؟'],
  };
};

const buildInventoryAlertsAnswer = (dashboard: DashboardPayload) => {
  const alerts = getDashboardStockAlerts(dashboard)
    .filter((item) => item.severity === 'out_of_stock' || item.severity === 'low_stock' || item.severity === 'configuration');
  if (alerts.length === 0) return 'لا توجد أصناف ناقصة أو نافدة أو تحتاج تهيئة حاليًا.';
  return `الأصناف التي تحتاج تدخلاً الآن: ${alerts.slice(0, 4).map(describeStockAlert).join('، ')}.`;
};

const buildInventoryAlertsCard = (dashboard: DashboardPayload): AssistantCard => {
  const alerts = getDashboardStockAlerts(dashboard)
    .filter((item) => item.severity === 'out_of_stock' || item.severity === 'low_stock' || item.severity === 'configuration');
  const outOfStock = alerts.filter((item) => item.severity === 'out_of_stock').length;
  if (alerts.length === 0) {
    return {
      title: 'المخزون بحاجة متابعة؟',
      subtitle: 'لا توجد أصناف ناقصة أو نافدة حاليًا',
      tone: 'success',
      facts: [{ label: 'تنبيهات المخزون', value: '0', tone: 'positive' }],
      suggestions: ['ما أهم الأمور التي تحتاج متابعة الآن؟', 'أعطني ملخصاً مختصراً لأداء اليوم.'],
    };
  }
  return {
    title: 'أصناف تحتاج تدخلاً',
    subtitle: outOfStock > 0 ? 'ابدأ بالأصناف النافدة قبل الأصناف المنخفضة' : 'راجع إعادة الطلب قريبًا',
    tone: outOfStock > 0 ? 'danger' : 'warning',
    facts: alerts.slice(0, 6).map((item) => ({
      label: item.productName || item.sku,
      value: item.severity === 'configuration'
        ? 'يحتاج تهيئة'
        : formatInventoryQuantity(item),
      tone: item.severity === 'out_of_stock'
        ? 'danger'
        : item.severity === 'low_stock'
          ? 'warning'
          : 'default',
    })),
    suggestions: ['ما أهم الأمور التي تحتاج متابعة الآن؟', 'ما هي حالة الطلبات؟'],
  };
};

const buildMonthlyCard = (report: MonthlyReport): AssistantCard => ({
  title: `تقرير ${report.periodLabel || 'الشهر الحالي'}`,
  subtitle: report.branchCount > 1 ? `${report.branchCount} فروع نشطة` : 'للفرع النشط',
  tone: report.inventory.lowStockProducts > 0 || report.sales.outstandingInMinorUnits > 0 ? 'warning' : 'info',
  facts: [
    { label: 'المبيعات الصافية', value: formatJod(report.sales.netSalesInMinorUnits), tone: 'positive' },
    { label: 'صافي الربح', value: formatJod(report.sales.netProfitInMinorUnits), tone: 'positive' },
    { label: 'مصروفات التشغيل', value: formatJod(report.expenses.totalInMinorUnits) },
    { label: 'ذمم العملاء', value: formatJod(report.balances.customerDueInMinorUnits), tone: report.balances.customerDueInMinorUnits > 0 ? 'warning' : 'positive' },
    { label: 'مخزون يحتاج متابعة', value: String(report.inventory.lowStockProducts), tone: report.inventory.lowStockProducts > 0 ? 'warning' : 'positive' },
    { label: 'طلبات/فواتير', value: String(report.sales.orderCount) },
  ],
  suggestions: ['ما أهم الأمور التي تحتاج متابعة الآن؟', 'أعطني ملخصاً مختصراً لأداء اليوم.'],
});

const buildProfitCard = (valueInMinorUnits: unknown): AssistantCard => ({
  title: 'صافي ربح الشهر',
  subtitle: 'حتى هذه اللحظة من الشهر الحالي',
  tone: 'info',
  facts: [{ label: 'صافي الربح', value: formatJod(valueInMinorUnits), tone: 'positive' }],
  suggestions: ['أعطني التقرير الشهري الحالي.', 'ما وضع الذمم الحالية؟'],
});

const buildGenericAnswerCard = (): AssistantCard => ({
  title: 'إجابة المساعد',
  subtitle: 'تحليل مبني على ملخص العمل الحالي',
  tone: 'info',
});

const buildGreetingCard = (): AssistantCard => ({
  title: 'أهلًا، أنا جاهز 👋',
  subtitle: 'مساعد نواصرة التشغيلي من بيانات النظام الحالية',
  tone: 'info',
  facts: [
    { label: 'المخزون', value: 'كمية وسعر الطرد' },
    { label: 'المتابعة', value: 'طلبات وذمم وتنبيهات' },
    { label: 'التقارير', value: 'ملخص يومي وأسبوعي وشهري' },
  ],
  suggestions: [
    'ما أهم الأمور التي تحتاج متابعة الآن؟',
    'هل Water موجود؟',
    'ما وضع الذمم الحالية؟',
    'أعطني التقرير الشهري الحالي.',
  ],
});

const buildHelpCard = (): AssistantCard => ({
  title: 'كيف أساعدك؟',
  subtitle: 'أسئلة قصيرة، وإجابات حقيقية من النظام فقط',
  tone: 'info',
  facts: [
    { label: 'منتج', value: 'هل Water موجود؟ أو كم سعره؟' },
    { label: 'العمل اليومي', value: 'ما أهم الأمور التي تحتاج متابعة؟' },
    { label: 'التقارير', value: 'ملخص اليوم أو الأسبوع أو الشهر' },
  ],
  suggestions: [
    'ما هي أصناف المخزون التي تحتاج تدخلاً؟',
    'ما هي حالة الطلبات؟',
    'أعطني ملخصاً مختصراً لأداء اليوم.',
    'ما وضع الذمم الحالية؟',
  ],
});

const buildSafeFallbackAnswer = () => ({
  answer: 'أستطيع المساعدة في المخزون والطلبات والذمم والتقارير. اختر سؤالًا من الاقتراحات أو اكتب ما تريد باختصار.',
  card: buildHelpCard(),
});

const isSafeModelAnswer = (answer: string) => {
  const normalized = answer.trim();
  if (!normalized || normalized.length > 900 || !/[\u0600-\u06ff]/.test(normalized)) return false;
  return !/(system\s*instruction|no assumptions|guessing|line\s*\/?\s*\d|availablesalepackages|availablebaseunits|inventorymatches|generatedat|generationconfig|role:\s*(user|model))/i.test(normalized);
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

const systemInstruction = 'أنت مساعد إداري عربي لنظام نواصرة للجملة. أجب بالعربية فقط وباختصار شديد: سطر أو سطران، أو حتى 3 نقاط قصيرة عند الحاجة. ' +
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

  let body: { message?: unknown; context?: unknown; productSku?: unknown };
  try {
    body = await request.json();
  } catch {
    return respond({ error: 'صيغة الطلب غير صحيحة.' }, 400, origin);
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const followUpContext = asAssistantContext(body.context);
  const followUpProductSku = typeof body.productSku === 'string' && body.productSku.trim().length > 0 && body.productSku.trim().length <= 128
    ? body.productSku.trim()
    : undefined;
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

  // Greetings and "what can you do?" are not business queries. Keep them
  // deterministic so a language-model response can never look like a leaked
  // prompt or leave the operator without a useful next action.
  if (isGreetingMessage(message)) {
    return respond(
      {
        answer: 'أهلًا! أنا جاهز لمساعدتك في عمل المحل الآن.',
        card: buildGreetingCard(),
      },
      200,
      origin,
    );
  }
  if (isHelpQuestion(message)) {
    return respond(buildSafeFallbackAnswer(), 200, origin);
  }

  const { data: inventorySnapshot, error: inventoryError } = await caller.rpc(
    'get_admin_ai_inventory_snapshot',
  );
  if (inventoryError) {
    console.error('get_admin_ai_inventory_snapshot failed', inventoryError.code);
    return respond({ error: 'تعذر تحميل مخزون الأصناف الحالي.' }, 500, origin);
  }

  const inventoryItems = mapInventoryItems(
    inventorySnapshot as InventorySnapshotPayload | InventorySnapshotPayload[],
  );
  const inventoryMatches = findInventoryMatches(message, inventoryItems);
  const followUpProduct = findInventoryItemBySku(followUpProductSku, inventoryItems);

  // Price must be checked before availability. The old broad "كم" stock
  // intent incorrectly treated "كم سعر Water؟" as a stock question.
  if (isProductPriceQuestion(message)) {
    if (inventoryMatches.length > 1) {
      return respond({ answer: buildProductClarificationAnswer(), context: 'inventory' }, 200, origin);
    }
    const product = inventoryMatches[0] || followUpProduct;
    if (!product) {
      return respond({ answer: buildProductClarificationAnswer(), context: 'inventory' }, 200, origin);
    }
    return respond(
      {
        answer: buildDirectProductPriceAnswer(product),
        context: 'inventory',
        productSku: product.sku,
        card: buildProductPriceCard(product),
      },
      200,
      origin,
    );
  }
  if (isAvailabilityQuestion(message) && inventoryMatches.length > 0) {
    const matchedProduct = inventoryMatches.length === 1 ? inventoryMatches[0] : undefined;
    return respond(
      {
        answer: buildDirectInventoryAnswer(inventoryMatches),
        context: 'inventory',
        card: buildInventoryCard(inventoryMatches),
        ...(matchedProduct ? { productSku: matchedProduct.sku } : {}),
      },
      200,
      origin,
    );
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
  if (isAvailabilityQuestion(message) && dashboardInventoryMatches.length > 0) {
    const matchedProduct = dashboardInventoryMatches.length === 1 ? dashboardInventoryMatches[0] : undefined;
    return respond(
      {
        answer: buildDirectInventoryAnswer(dashboardInventoryMatches),
        context: 'inventory',
        card: buildInventoryCard(dashboardInventoryMatches),
        ...(matchedProduct ? { productSku: matchedProduct.sku } : {}),
      },
      200,
      origin,
    );
  }

  // These are business facts, not language-model interpretations. Answer the
  // common financial and operational questions directly from guarded RPC data.
  if (isInventoryAlertQuestion(message)) {
    return respond(
      {
        answer: buildInventoryAlertsAnswer(dashboardPayload),
        context: 'inventory',
        card: buildInventoryAlertsCard(dashboardPayload),
      },
      200,
      origin,
    );
  }
  if (isDebtQuestion(message)) {
    return respond({ answer: buildDirectDebtAnswer(dashboardPayload), context: 'debts', card: buildDebtCard(dashboardPayload) }, 200, origin);
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
    return respond({ answer: buildDirectMonthlyReportAnswer(mappedMonthlyReport), context: 'monthly_report', card: buildMonthlyCard(mappedMonthlyReport) }, 200, origin);
  }
  if (isWeeklySummaryQuestion(message)) {
    return respond({ answer: buildDirectWeeklySummary(dashboardPayload), context: 'weekly_summary', card: buildWeeklyCard(dashboardPayload) }, 200, origin);
  }
  if (isOrderStatusQuestion(message)) {
    return respond({ answer: buildDirectOrderStatusAnswer(dashboardPayload), context: 'orders', card: buildOrdersCard(dashboardPayload) }, 200, origin);
  }
  if (isDailySummaryQuestion(message)) {
    return respond({ answer: buildDirectDailySummary(dashboardPayload), context: 'daily_summary', card: buildDailyCard(dashboardPayload) }, 200, origin);
  }
  if (isProfitQuestion(message)) {
    const summary = dashboardPayload.summary || {};
    const profit = summary.monthProfitInMinorUnits ?? summary.netProfitThisMonth;
    if (profit !== null && profit !== undefined) {
      return respond(
        {
          answer: `صافي ربح الشهر حتى الآن: ${formatJod(profit)}. للمبيعات التفصيلية والمصروفات اسأل: «أعطني التقرير الشهري».`,
          context: 'profit',
          card: buildProfitCard(profit),
        },
        200,
        origin,
      );
    }
  }
  if (isPriorityMonitoringQuestion(message)) {
    return respond({ answer: buildDirectMonitoringAnswer(dashboardPayload), context: 'monitoring', card: buildMonitoringCard(dashboardPayload) }, 200, origin);
  }
  if (isAmbiguousFollowUpQuestion(message)) {
    // A short question such as "ما هي؟" has no subject by itself. The browser
    // can pass only a safe topic token, and monitoring is the useful default
    // if the message was opened fresh without prior context.
    if (followUpContext === 'debts') {
      return respond({ answer: buildDirectDebtAnswer(dashboardPayload), context: 'debts', card: buildDebtCard(dashboardPayload) }, 200, origin);
    }
    if (followUpContext === 'orders') {
      return respond({ answer: buildDirectOrderStatusAnswer(dashboardPayload), context: 'orders', card: buildOrdersCard(dashboardPayload) }, 200, origin);
    }
    if (followUpContext === 'daily_summary') {
      return respond({ answer: buildDirectDailySummary(dashboardPayload), context: 'daily_summary', card: buildDailyCard(dashboardPayload) }, 200, origin);
    }
    if (followUpContext === 'weekly_summary') {
      return respond({ answer: buildDirectWeeklySummary(dashboardPayload), context: 'weekly_summary', card: buildWeeklyCard(dashboardPayload) }, 200, origin);
    }
    if (followUpContext === 'profit') {
      const summary = dashboardPayload.summary || {};
      const profit = summary.monthProfitInMinorUnits ?? summary.netProfitThisMonth;
      if (profit !== null && profit !== undefined) {
        return respond({ answer: `صافي ربح الشهر حتى الآن: ${formatJod(profit)}.`, context: 'profit', card: buildProfitCard(profit) }, 200, origin);
      }
    }
    if (followUpContext === 'inventory') {
      if (followUpProduct) {
        return respond(
          {
            answer: buildDirectInventoryAnswer([{ ...followUpProduct, score: 100 }]),
            context: 'inventory',
            productSku: followUpProduct.sku,
            card: buildInventoryCard([{ ...followUpProduct, score: 100 }]),
          },
          200,
          origin,
        );
      }
      return respond({ answer: 'اكتب اسم المنتج أو SKU لأعطيك الكمية المتاحة بدقة.', context: 'inventory' }, 200, origin);
    }
    return respond({ answer: buildDirectMonitoringAnswer(dashboardPayload), context: 'monitoring', card: buildMonitoringCard(dashboardPayload) }, 200, origin);
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
    return respond(buildSafeFallbackAnswer(), 200, origin);
  }
  if (!isSafeModelAnswer(answer)) {
    console.warn('Discarded an unsafe or non-Arabic model response');
    return respond(buildSafeFallbackAnswer(), 200, origin);
  }
  return respond({ answer, card: buildGenericAnswerCard() }, 200, origin);
});
