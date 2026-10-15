/**
 * Go-live setup Excel model: one template per kind, header-based column
 * matching, per-row Arabic validation and conversion to the exact RPC rows.
 * Money stays integer fils (1 JOD = 1000) parsed from text — never floats.
 * The database re-validates every row; this layer only gives early feedback.
 */

export type GoLiveKind = 'products' | 'stock' | 'customers' | 'suppliers';

export interface GoLiveColumn {
  key: string;
  header: string;
  required: boolean;
  example: string;
  width?: number;
}

export interface RowError { row: number; message: string }

export const GO_LIVE_COLUMNS: Readonly<Record<GoLiveKind, readonly GoLiveColumn[]>> = {
  products: [
    { key: 'sku', header: 'رمز الصنف SKU', required: true, example: 'CHO-001' },
    { key: 'barcode', header: 'الباركود', required: false, example: '6281000000017' },
    { key: 'name_ar', header: 'اسم المنتج', required: true, example: 'شوكولاتة بالحليب 40غ', width: 30 },
    { key: 'category_name', header: 'القسم', required: true, example: 'شوكولاتة' },
    { key: 'base_unit_name', header: 'الوحدة الصغرى', required: true, example: 'باكيت' },
    { key: 'purchase_unit_name', header: 'طرد الشراء', required: true, example: 'كرتونة' },
    { key: 'units_per_purchase_unit', header: 'عدد الحبات في طرد الشراء', required: true, example: '24' },
    { key: 'sale_unit_name', header: 'طرد البيع', required: true, example: 'كرتونة' },
    { key: 'units_per_sale_unit', header: 'عدد الحبات في طرد البيع', required: true, example: '24' },
    { key: 'sale_package_price', header: 'سعر بيع الطرد (د.أ)', required: true, example: '6.000' },
    { key: 'purchase_package_price', header: 'سعر شراء الطرد (د.أ)', required: false, example: '4.800' },
    { key: 'cost_per_base_unit', header: 'تكلفة الحبة (د.أ)', required: true, example: '0.200' },
    { key: 'min_stock_level', header: 'الحد الأدنى للمخزون (حبة)', required: false, example: '48' },
  ],
  stock: [
    { key: 'code', header: 'الباركود أو SKU', required: true, example: 'CHO-001' },
    { key: 'name', header: 'اسم الصنف (للمراجعة فقط)', required: false, example: 'شوكولاتة بالحليب 40غ', width: 30 },
    { key: 'package_count', header: 'عدد الطرود', required: true, example: '3' },
    { key: 'loose_units', header: 'الحبات الإضافية', required: false, example: '5' },
  ],
  customers: [
    { key: 'customer_phone', header: 'هاتف العميل', required: true, example: '0790000000' },
    { key: 'customer_name', header: 'اسم العميل (للمراجعة فقط)', required: false, example: 'محمد أحمد', width: 26 },
    { key: 'amount', header: 'مبلغ الدين (د.أ)', required: true, example: '125.500' },
    { key: 'original_date', header: 'تاريخ الدين الأصلي', required: true, example: '2025-03-15' },
    { key: 'notes', header: 'ملاحظة', required: false, example: 'من الدفتر القديم', width: 30 },
  ],
  suppliers: [
    { key: 'supplier_name', header: 'اسم المورد', required: true, example: 'شركة التوزيع', width: 28 },
    { key: 'direction', header: 'الاتجاه (له/عليه)', required: true, example: 'له' },
    { key: 'amount', header: 'المبلغ (د.أ)', required: true, example: '1500.000' },
    { key: 'original_date', header: 'تاريخ الرصيد الأصلي', required: true, example: '2025-06-30' },
    { key: 'notes', header: 'ملاحظة', required: false, example: 'كشف المورد', width: 30 },
  ],
};

export const GO_LIVE_TEMPLATE_NOTES: Readonly<Record<GoLiveKind, readonly string[]>> = {
  products: [
    'سطر لكل منتج عادي. النكهات تُضاف من شاشة المنتجات لأنها مرتبطة بمنتج أساسي.',
    'القسم والوحدات بالاسم العربي كما في النظام، أو برمز الوحدة (مثل PKT أو CTN).',
    'الأسعار بالدينار بثلاث منازل عشرية كحد أقصى. المنتج يُنشأ برصيد صفر.',
  ],
  stock: [
    'سطر لكل صنف: الباركود أو SKU كما في النظام. للنكهات استخدم باركود النكهة نفسها.',
    'الكمية = عدد الطرود × محتوى الطرد + الحبات الإضافية (أقل من محتوى الطرد).',
    'التكلفة تُؤخذ من تكلفة الصنف في النظام. الصنف الذي بدأت حركاته يُعدّل بالجرد.',
  ],
  customers: [
    'سطر لكل دين قديم بتاريخه الأصلي. يُطابق العميل برقم هاتفه المسجل في النظام.',
    'المبلغ بالدينار. التاريخ بصيغة 2025-03-15 ولا يكون في المستقبل.',
    'الدين الافتتاحي لا يُحتسب مبيعات ولا أرباحاً ولا يدخل الوردية.',
  ],
  suppliers: [
    'سطر واحد لكل مورد بصافي رصيده. "له" = نحن مدينون للمورد، "عليه" = المورد مدين لنا.',
    'اسم المورد كما هو مسجل في النظام حرفياً.',
    'المبلغ بالدينار، والتاريخ بصيغة 2025-06-30.',
  ],
};

export const GO_LIVE_BATCH_SIZE: Readonly<Record<GoLiveKind, number>> = {
  products: 100, stock: 200, customers: 200, suppliers: 200,
};

const arabicDigits = /[٠-٩۰-۹]/gu;
export function normalizeDigits(value: string): string {
  return value.replace(arabicDigits, d => String((d.charCodeAt(0) & 0xf) % 10))
    .replace(/٫/gu, '.').replace(/[٬،]/gu, ',').trim();
}

/** "12.5" / "1,250.500" → fils as a decimal string; null when invalid. */
export function parseJodToMinor(value: string): string | null {
  const text = normalizeDigits(value).replace(/,/gu, '').replace(/\s/gu, '');
  const match = /^(\d{1,9})(?:\.(\d{0,3}))?$/u.exec(text);
  if (!match) return null;
  const minor = BigInt(match[1]) * 1000n + BigInt((match[2] ?? '').padEnd(3, '0') || '0');
  return minor.toString();
}

export function parseWholeNumber(value: string, { min = 0, max = 999_999 } = {}): number | null {
  const text = normalizeDigits(value);
  if (!/^\d{1,9}$/u.test(text)) return null;
  const number = Number(text);
  return number >= min && number <= max ? number : null;
}

const isoDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
};

/** Accepts 2025-03-15, 15/3/2025 and an Excel date serial (1900 system). */
export function parseDate(value: string): string | null {
  const text = normalizeDigits(value);
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u.exec(text);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/u.exec(text);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  if (/^\d{5}(?:\.\d+)?$/u.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial < 36526 || serial > 73050) return null; // 2000-01-01 .. 2099-12-31
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

export function ammanToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export interface SheetRow { row: number; values: Record<string, string> }

/** Matches the template headers (row 1) and returns the non-empty data rows. */
export function mapSheet(kind: GoLiveKind, sheet: readonly (readonly string[])[]): { rows: SheetRow[]; fileErrors: string[] } {
  const columns = GO_LIVE_COLUMNS[kind];
  const header = (sheet[0] ?? []).map(cell => cell.replace(/\s+/gu, ' ').trim());
  const indexes = new Map<string, number>();
  const fileErrors: string[] = [];
  for (const column of columns) {
    const index = header.indexOf(column.header);
    if (index >= 0) indexes.set(column.key, index);
    else if (column.required) fileErrors.push(`العمود "${column.header}" غير موجود في الصف الأول؛ استخدم القالب كما هو.`);
  }
  const rows: SheetRow[] = [];
  sheet.slice(1).forEach((cells, offset) => {
    if (!cells.some(cell => cell.trim() !== '')) return;
    const values: Record<string, string> = {};
    for (const column of columns) values[column.key] = (cells[indexes.get(column.key) ?? -1] ?? '').trim();
    rows.push({ row: offset + 2, values });
  });
  if (!fileErrors.length && rows.length === 0) fileErrors.push('الملف لا يحتوي أي سطر بيانات تحت العناوين.');
  return { rows, fileErrors };
}

export interface StockProductRef {
  productId: string; sku: string; barcode?: string; productName: string;
  unitsPerPackage: number; eligible: boolean; blockReason?: string; costPriceInMinorUnits: number;
}

export interface PreparedRows<T> { payload: (T & { sourceRow: number })[]; errors: RowError[] }

export interface ProductPayload {
  sku: string; barcode: string; name_ar: string; category_name: string; base_unit_name: string;
  purchase_unit_name: string; units_per_purchase_unit: string; sale_unit_name: string; units_per_sale_unit: string;
  sale_package_price_in_minor_units: string; purchase_package_price_in_minor_units: string;
  cost_per_base_unit_in_minor_units: string; min_stock_level: string;
}
export interface StockPayload { productId: string; packageCount: number; looseUnits: number; productName: string; baseQuantity: number }
export interface CustomerPayload { customer_phone: string; amount_in_minor_units: string; original_debt_date: string; notes?: string }
export interface SupplierPayload { supplier_name: string; direction: 'payable' | 'advance'; amount_in_minor_units: string; original_balance_date: string; notes?: string }

function requireText(values: Record<string, string>, columns: readonly GoLiveColumn[]): string | null {
  const missing = columns.find(column => column.required && !values[column.key]);
  return missing ? `"${missing.header}" مطلوب.` : null;
}

export function prepareProducts(rows: readonly SheetRow[]): PreparedRows<ProductPayload> {
  const result: PreparedRows<ProductPayload> = { payload: [], errors: [] };
  const seen = new Map<string, number>();
  for (const { row, values } of rows) {
    const fail = (message: string) => result.errors.push({ row, message });
    const missing = requireText(values, GO_LIVE_COLUMNS.products);
    if (missing) { fail(missing); continue; }
    const perPurchase = parseWholeNumber(values.units_per_purchase_unit, { min: 1 });
    const perSale = parseWholeNumber(values.units_per_sale_unit, { min: 1 });
    const salePrice = parseJodToMinor(values.sale_package_price);
    const purchasePrice = values.purchase_package_price ? parseJodToMinor(values.purchase_package_price) : '0';
    const cost = parseJodToMinor(values.cost_per_base_unit);
    const minStock = values.min_stock_level ? parseWholeNumber(values.min_stock_level) : 0;
    if (perPurchase === null || perSale === null) { fail('عدد الحبات في الطرد يجب أن يكون رقماً صحيحاً أكبر من صفر.'); continue; }
    if (salePrice === null || salePrice === '0') { fail('سعر بيع الطرد يجب أن يكون مبلغاً أكبر من صفر بثلاث منازل كحد أقصى.'); continue; }
    if (purchasePrice === null || cost === null) { fail('سعر الشراء والتكلفة يجب أن تكون مبالغ صحيحة بثلاث منازل كحد أقصى.'); continue; }
    if (minStock === null) { fail('الحد الأدنى للمخزون يجب أن يكون رقماً صحيحاً.'); continue; }
    const sku = values.sku.toLowerCase();
    if (seen.has(sku)) { fail(`رمز SKU مكرر داخل الملف (السطر ${seen.get(sku)}).`); continue; }
    seen.set(sku, row);
    result.payload.push({ sourceRow: row, sku: values.sku, barcode: values.barcode, name_ar: values.name_ar,
      category_name: values.category_name, base_unit_name: values.base_unit_name,
      purchase_unit_name: values.purchase_unit_name, units_per_purchase_unit: String(perPurchase),
      sale_unit_name: values.sale_unit_name, units_per_sale_unit: String(perSale),
      sale_package_price_in_minor_units: salePrice, purchase_package_price_in_minor_units: purchasePrice,
      cost_per_base_unit_in_minor_units: cost, min_stock_level: String(minStock) });
  }
  return result;
}

export function prepareStock(rows: readonly SheetRow[], products: readonly StockProductRef[]): PreparedRows<StockPayload> {
  const result: PreparedRows<StockPayload> = { payload: [], errors: [] };
  const byCode = new Map<string, StockProductRef[]>();
  for (const product of products) {
    for (const code of [product.sku, product.barcode].filter((c): c is string => Boolean(c))) {
      const key = code.trim().toLowerCase();
      byCode.set(key, [...(byCode.get(key) ?? []).filter(p => p.productId !== product.productId), product]);
    }
  }
  const seen = new Map<string, number>();
  for (const { row, values } of rows) {
    const fail = (message: string) => result.errors.push({ row, message });
    const missing = requireText(values, GO_LIVE_COLUMNS.stock);
    if (missing) { fail(missing); continue; }
    const matches = byCode.get(normalizeDigits(values.code).toLowerCase()) ?? [];
    if (matches.length === 0) { fail('لا يوجد صنف قابل للجرد بهذا الباركود أو SKU. المنتج الأساسي للنكهات لا يُجرد؛ استخدم باركود النكهة.'); continue; }
    if (matches.length > 1) { fail('الرمز يطابق أكثر من صنف؛ استخدم SKU بدل الباركود.'); continue; }
    const product = matches[0];
    if (!product.eligible) { fail(product.blockReason || 'هذا الصنف غير متاح للرصيد الافتتاحي.'); continue; }
    const packages = parseWholeNumber(values.package_count, { max: 9_999_999 });
    const loose = values.loose_units ? parseWholeNumber(values.loose_units, { max: 9_999_999 }) : 0;
    if (packages === null || loose === null) { fail('عدد الطرود والحبات يجب أن تكون أرقاماً صحيحة موجبة.'); continue; }
    if (loose >= product.unitsPerPackage) {
      fail(`الحبات الإضافية يجب أن تكون أقل من محتوى الطرد (${product.unitsPerPackage}).`); continue;
    }
    const quantity = packages * product.unitsPerPackage + loose;
    if (quantity > 2_147_483_647) { fail('الكمية أكبر من الحد المسموح.'); continue; }
    if (quantity > 0 && product.costPriceInMinorUnits <= 0) { fail('أدخل تكلفة الشراء للصنف في شاشة المنتجات أولاً.'); continue; }
    if (seen.has(product.productId)) { fail(`الصنف مكرر داخل الملف (السطر ${seen.get(product.productId)}).`); continue; }
    seen.set(product.productId, row);
    result.payload.push({ sourceRow: row, productId: product.productId, packageCount: packages,
      looseUnits: loose, productName: product.productName, baseQuantity: quantity });
  }
  return result;
}

export function prepareCustomers(rows: readonly SheetRow[], today = ammanToday()): PreparedRows<CustomerPayload> {
  const result: PreparedRows<CustomerPayload> = { payload: [], errors: [] };
  for (const { row, values } of rows) {
    const fail = (message: string) => result.errors.push({ row, message });
    const missing = requireText(values, GO_LIVE_COLUMNS.customers);
    if (missing) { fail(missing); continue; }
    const amount = parseJodToMinor(values.amount);
    const date = parseDate(values.original_date);
    if (amount === null || amount === '0') { fail('مبلغ الدين يجب أن يكون أكبر من صفر بثلاث منازل كحد أقصى.'); continue; }
    if (!date) { fail('تاريخ الدين الأصلي غير صحيح؛ استخدم الصيغة 2025-03-15.'); continue; }
    if (date > today) { fail('تاريخ الدين الأصلي لا يمكن أن يكون في المستقبل.'); continue; }
    if (date < '2000-01-01') { fail('تاريخ الدين الأصلي أقدم من المسموح (2000-01-01).'); continue; }
    if (values.notes.length > 300) { fail('الملاحظة أطول من 300 حرف.'); continue; }
    result.payload.push({ sourceRow: row, customer_phone: normalizeDigits(values.customer_phone),
      amount_in_minor_units: amount, original_debt_date: date, ...(values.notes ? { notes: values.notes } : {}) });
  }
  return result;
}

export function parseDirection(value: string): 'payable' | 'advance' | null {
  const text = value.replace(/\s+/gu, '').toLowerCase();
  if (['له', 'دائن', 'payable'].includes(text)) return 'payable';
  if (['عليه', 'مدين', 'advance'].includes(text)) return 'advance';
  return null;
}

export function prepareSuppliers(rows: readonly SheetRow[], today = ammanToday()): PreparedRows<SupplierPayload> {
  const result: PreparedRows<SupplierPayload> = { payload: [], errors: [] };
  const seen = new Map<string, number>();
  for (const { row, values } of rows) {
    const fail = (message: string) => result.errors.push({ row, message });
    const missing = requireText(values, GO_LIVE_COLUMNS.suppliers);
    if (missing) { fail(missing); continue; }
    const direction = parseDirection(values.direction);
    const amount = parseJodToMinor(values.amount);
    const date = parseDate(values.original_date);
    if (!direction) { fail('الاتجاه يجب أن يكون "له" أو "عليه".'); continue; }
    if (amount === null || amount === '0') { fail('المبلغ يجب أن يكون أكبر من صفر بثلاث منازل كحد أقصى.'); continue; }
    if (!date) { fail('تاريخ الرصيد الأصلي غير صحيح؛ استخدم الصيغة 2025-06-30.'); continue; }
    if (date > today) { fail('تاريخ الرصيد الأصلي لا يمكن أن يكون في المستقبل.'); continue; }
    if (date < '2000-01-01') { fail('تاريخ الرصيد الأصلي أقدم من المسموح (2000-01-01).'); continue; }
    const name = values.supplier_name.trim();
    if (seen.has(name)) { fail(`المورد مكرر داخل الملف (السطر ${seen.get(name)}); اجعل له سطراً واحداً بصافي الرصيد.`); continue; }
    seen.set(name, row);
    result.payload.push({ sourceRow: row, supplier_name: name, direction, amount_in_minor_units: amount,
      original_balance_date: date, ...(values.notes ? { notes: values.notes } : {}) });
  }
  return result;
}

export function templateRows(kind: GoLiveKind): string[][] {
  const columns = GO_LIVE_COLUMNS[kind];
  return [columns.map(column => column.header), columns.map(column => column.example)];
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Server row numbers are 1-based within a batch; map them back to sheet rows. */
export function mapServerErrors(batch: readonly { sourceRow: number }[], errors: readonly RowError[]): RowError[] {
  return errors.map(error => ({ row: batch[error.row - 1]?.sourceRow ?? error.row, message: error.message }));
}

export const stripSourceRow = <T extends { sourceRow: number }>({ sourceRow: _sourceRow, ...rest }: T) => rest;
