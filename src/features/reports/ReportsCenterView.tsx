import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  BarChart3,
  Boxes,
  CircleAlert,
  FileDown,
  HandCoins,
  Loader2,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import { fetchOperationalBusinessReportFromSupabase } from '../../services/supabase/reports.service';
import { useAppStore } from '../../stores/useAppStore';
import type { OperationalBusinessReport } from '../../types';

const pad = (value: number) => String(value).padStart(2, '0');
const localDateValue = (value: Date) =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

const todayValue = () => localDateValue(new Date());
const monthStartValue = () => {
  const today = new Date();
  return localDateValue(new Date(today.getFullYear(), today.getMonth(), 1));
};

const money = (value: number) =>
  `${value.toLocaleString('ar-JO', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} ${CURRENCY}`;

const paymentLabel = (method: string) =>
  ({
    cash: 'كاش',
    cash_on_delivery: 'كاش عند الاستلام',
    cliq: 'CliQ',
    card: 'بطاقة',
    bank_transfer: 'تحويل بنكي',
    debt: 'آجل',
    mixed: 'مختلط',
  })[method] || method || 'غير محدد';

const movementLabel = (movementType: string) =>
  ({
    opening_balance: 'رصيد افتتاحي',
    purchase_receipt: 'استلام مورد',
    sales_deduction: 'مبيعات وتسليم',
    transfer_in: 'تحويل وارد',
    transfer_out: 'تحويل صادر',
    adjustment_add: 'زيادة جرد/تسوية',
    adjustment_subtract: 'نقص جرد/تسوية',
    return_in: 'مرتجع داخل المخزون',
    return_out: 'إخراج مرتجع/عكس استلام',
  })[movementType] || movementType || 'حركة أخرى';

const MetricCard: React.FC<{
  label: string;
  value: string;
  hint: string;
  icon: React.ElementType;
  tone: 'blue' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet';
}> = ({ label, value, hint, icon: Icon, tone }) => {
  const tones = {
    blue: 'border-blue-500/30 bg-blue-950/30 text-blue-300',
    emerald: 'border-emerald-500/30 bg-emerald-950/30 text-emerald-300',
    amber: 'border-amber-500/30 bg-amber-950/30 text-amber-300',
    rose: 'border-rose-500/30 bg-rose-950/30 text-rose-300',
    cyan: 'border-cyan-500/30 bg-cyan-950/30 text-cyan-300',
    violet: 'border-violet-500/30 bg-violet-950/30 text-violet-300',
  };

  return (
    <article className={`print-card rounded-2xl border p-3 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="block text-[10px] font-bold text-slate-400">{label}</span>
          <strong className="mt-1 block text-sm font-black">{value}</strong>
        </div>
        <Icon className="h-4 w-4 shrink-0" />
      </div>
      <p className="mt-1 text-[9px] leading-4 text-slate-500">{hint}</p>
    </article>
  );
};

export const ReportsCenterView: React.FC = () => {
  const { activeBranch, setToast } = useAppStore();
  const [dateFrom, setDateFrom] = useState(monthStartValue);
  const [dateTo, setDateTo] = useState(todayValue);
  const [report, setReport] = useState<OperationalBusinessReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    if (!activeBranch.id) return;
    if (!dateFrom || !dateTo || dateTo < dateFrom) {
      setError('اختر فترة صحيحة: تاريخ النهاية يجب ألا يسبق البداية.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const nextReport = await fetchOperationalBusinessReportFromSupabase(
        activeBranch.id,
        dateFrom,
        dateTo
      );
      setReport(nextReport);
    } catch (loadError) {
      setReport(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'تعذر تحميل التقرير من قاعدة البيانات.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeBranch.id, dateFrom, dateTo]);

  useEffect(() => {
    void loadReport();
  }, [activeBranch.id]);

  const setPreset = (days: number | 'month') => {
    const end = new Date();
    const start =
      days === 'month'
        ? new Date(end.getFullYear(), end.getMonth(), 1)
        : new Date(end.getFullYear(), end.getMonth(), end.getDate() - days + 1);
    setDateFrom(localDateValue(start));
    setDateTo(localDateValue(end));
  };

  const handlePrint = () => {
    if (!report) {
      setToast('حمّل التقرير أولاً قبل الطباعة أو الحفظ PDF.', 'error');
      return;
    }
    window.print();
  };

  return (
    <div className="space-y-4 p-4 pb-24">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 11mm; }
          html, body { background: #ffffff !important; }
          body * { visibility: hidden !important; }
          .operational-report-print,
          .operational-report-print * { visibility: visible !important; }
          .operational-report-print {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            color: #0f172a !important;
            background: #ffffff !important;
            font-family: Arial, Tahoma, sans-serif !important;
            direction: rtl !important;
          }
          .operational-report-print * {
            color: #0f172a !important;
            background: transparent !important;
            box-shadow: none !important;
          }
          .operational-report-print .print-card,
          .operational-report-print .print-section {
            border: 1px solid #cbd5e1 !important;
            break-inside: avoid;
          }
          .report-screen-actions { display: none !important; }
        }
      `}</style>

      <div className="report-screen-actions space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black text-slate-100">
              <BarChart3 className="h-5 w-5 text-violet-400" />
              التقارير والحسابات
            </h2>
            <p className="text-[11px] text-slate-400">
              أرقام فعلية من المبيعات والمخزون والمصروفات والموردين
            </p>
          </div>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!report || isLoading}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-600/20 px-3 py-2 text-[11px] font-black text-violet-200 disabled:opacity-40"
          >
            <FileDown className="h-4 w-4" />
            طباعة / PDF
          </button>
        </div>

        <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[10px] font-bold text-slate-400">
              <span>من تاريخ</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => setDateFrom(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100"
              />
            </label>
            <label className="space-y-1 text-[10px] font-bold text-slate-400">
              <span>إلى تاريخ</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                max={todayValue()}
                onChange={(event) => setDateTo(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100"
              />
            </label>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button type="button" onClick={() => setPreset(1)} className="shrink-0 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-slate-300">اليوم</button>
            <button type="button" onClick={() => setPreset(7)} className="shrink-0 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-slate-300">آخر 7 أيام</button>
            <button type="button" onClick={() => setPreset(30)} className="shrink-0 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-slate-300">آخر 30 يومًا</button>
            <button type="button" onClick={() => setPreset('month')} className="shrink-0 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-slate-300">هذا الشهر</button>
          </div>
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-xs font-black text-white disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isLoading ? 'جاري احتساب التقرير...' : 'تحديث التقرير'}
          </button>
        </section>
      </div>

      {error && (
        <section className="flex items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-xs leading-6 text-rose-200">
          <CircleAlert className="mt-1 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <button type="button" onClick={() => void loadReport()} className="mt-2 font-black underline">إعادة المحاولة</button>
          </div>
        </section>
      )}

      {isLoading && !report && !error && (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
          <span className="text-xs font-bold">يتم جمع الحسابات من Supabase...</span>
        </div>
      )}

      {report && (
        <main className="operational-report-print space-y-4" dir="rtl">
          <header className="print-section rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black text-violet-300">مؤسسة نواصرة التجارية</p>
                <h1 className="mt-1 text-base font-black text-white">التقرير المالي والتشغيلي</h1>
                <p className="mt-1 text-[10px] text-slate-400">{report.period.branchName}</p>
              </div>
              <div className="text-left text-[10px] leading-5 text-slate-400">
                <span className="block">من {report.period.dateFrom}</span>
                <span className="block">إلى {report.period.dateTo}</span>
                <span className="block">أنشئ: {new Date(report.generatedAt).toLocaleString('ar-JO')}</span>
              </div>
            </div>
          </header>

          <section className="grid grid-cols-2 gap-2">
            <MetricCard label="صافي المبيعات" value={money(report.sales.netSales)} hint={`${report.sales.orderCount} طلب مكتمل`} icon={ShoppingCart} tone="blue" />
            <MetricCard label="مجمل ربح البيع" value={money(report.sales.grossProfit)} hint={`تكلفة البضاعة ${money(report.sales.cogs)}`} icon={TrendingUp} tone="emerald" />
            <MetricCard label="صافي النتيجة" value={money(report.sales.netProfit)} hint="بعد المرتجعات والمصروفات" icon={Banknote} tone={report.sales.netProfit >= 0 ? 'cyan' : 'rose'} />
            <MetricCard label="المصروفات" value={money(report.expenses.total)} hint={`${report.expenses.count} حركة مصروف`} icon={ReceiptText} tone="amber" />
            <MetricCard label="ذمم العملاء" value={money(report.balances.customerDue)} hint={`${report.balances.customerCount} عميل عليهم رصيد`} icon={Users} tone="rose" />
            <MetricCard label="ذمم الموردين" value={money(report.balances.supplierDue)} hint={`${report.balances.supplierCount} مورد لهم رصيد`} icon={Truck} tone="violet" />
          </section>

          <section className="print-section space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-black text-slate-100">
                <Activity className="h-4 w-4 text-cyan-400" />
                حركة المخزون خلال الفترة
              </h3>
              <span className="text-[9px] font-bold text-slate-500">
                {report.inventoryMovements.affectedProducts} صنف متأثر
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="print-card rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-2">
                <ArrowDownToLine className="mx-auto h-4 w-4 text-emerald-400" />
                <b className="mt-1 block text-sm text-emerald-300">+{report.inventoryMovements.unitsIn}</b>
                <span className="text-[8px] text-slate-500">وحدات داخلة</span>
              </div>
              <div className="print-card rounded-xl border border-rose-500/20 bg-rose-950/20 p-2">
                <ArrowUpFromLine className="mx-auto h-4 w-4 text-rose-400" />
                <b className="mt-1 block text-sm text-rose-300">-{report.inventoryMovements.unitsOut}</b>
                <span className="text-[8px] text-slate-500">وحدات خارجة</span>
              </div>
              <div className="print-card rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-2">
                <Activity className="mx-auto h-4 w-4 text-cyan-400" />
                <b className="mt-1 block text-sm text-cyan-300">{report.inventoryMovements.netUnits > 0 ? '+' : ''}{report.inventoryMovements.netUnits}</b>
                <span className="text-[8px] text-slate-500">صافي التغير</span>
              </div>
            </div>
            {report.inventoryMovements.types.length === 0 ? (
              <p className="text-[10px] text-slate-500">لا توجد حركات مخزون خلال الفترة المحددة.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-800">
                <div className="grid grid-cols-[1fr_42px_52px_52px] bg-slate-950 px-2 py-2 text-[8px] font-bold text-slate-500">
                  <span>نوع الحركة</span><span>العدد</span><span>داخل</span><span>خارج</span>
                </div>
                {report.inventoryMovements.types.map((movement) => (
                  <div key={movement.movementType} className="grid grid-cols-[1fr_42px_52px_52px] border-t border-slate-800 px-2 py-2 text-[9px]">
                    <b>{movementLabel(movement.movementType)}</b>
                    <span>{movement.movementCount}</span>
                    <span className="text-emerald-400">{movement.unitsIn}</span>
                    <span className="text-rose-400">{movement.unitsOut}</span>
                  </div>
                ))}
              </div>
            )}
            {report.inventoryMovements.topProducts.length > 0 && (
              <div>
                <h4 className="mb-2 text-[10px] font-black text-slate-300">أكثر الأصناف حركة</h4>
                <div className="grid gap-1.5">
                  {report.inventoryMovements.topProducts.slice(0, 5).map((product) => (
                    <div key={`${product.sku}-${product.productName}`} className="flex items-center justify-between rounded-lg border border-slate-800 px-2 py-1.5 text-[9px]">
                      <span className="min-w-0 truncate"><b>{product.productName}</b> <small className="text-slate-500">{product.sku}</small></span>
                      <span className="shrink-0 text-slate-400">+{product.unitsIn} / -{product.unitsOut}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="print-section space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="flex items-center gap-2 text-sm font-black text-slate-100"><ShoppingCart className="h-4 w-4 text-blue-400" />تفاصيل المبيعات والربح</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
              <div className="flex justify-between"><span className="text-slate-400">إجمالي المبيعات</span><b>{money(report.sales.grossSales)}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">المرتجعات</span><b className="text-rose-300">{money(report.sales.refunds)}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">الخصومات</span><b>{money(report.sales.discount)}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">رسوم التوصيل</span><b>{money(report.sales.deliveryFees)}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">المبالغ المحصلة</span><b className="text-emerald-300">{money(report.sales.collected)}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">متبقي من مبيعات الفترة</span><b className="text-amber-300">{money(report.sales.outstanding)}</b></div>
            </div>
            <div className="grid grid-cols-4 gap-2 border-t border-slate-800 pt-3 text-center text-[10px]">
              <div><b className="block text-sm text-white">{report.sales.posOrderCount}</b><span className="text-slate-500">بيع مباشر</span></div>
              <div><b className="block text-sm text-white">{report.sales.websiteOrderCount}</b><span className="text-slate-500">طلبات موقع</span></div>
              <div><b className="block text-sm text-white">{report.sales.packageCount}</b><span className="text-slate-500">طرد مباع</span></div>
              <div><b className="block text-sm text-white">{report.sales.uniqueProductCount}</b><span className="text-slate-500">صنف مختلف</span></div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2">
            <article className="print-card space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-3">
              <h3 className="flex items-center gap-2 text-xs font-black text-slate-100"><PackageCheck className="h-4 w-4 text-cyan-400" />المخزون الحالي</h3>
              <div className="flex justify-between text-[10px]"><span className="text-slate-400">قيمة التكلفة</span><b>{money(report.inventory.value)}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-slate-400">أصناف لها رصيد</span><b>{report.inventory.stockedProducts}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-slate-400">حبات فعلية / محجوزة</span><b>{report.inventory.baseUnitsOnHand} / {report.inventory.baseUnitsReserved}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-slate-400">قربت تنفد</span><b className="text-amber-300">{report.inventory.lowStockProducts}</b></div>
            </article>
            <article className="print-card space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-3">
              <h3 className="flex items-center gap-2 text-xs font-black text-slate-100"><Boxes className="h-4 w-4 text-violet-400" />مشتريات الموردين</h3>
              <div className="flex justify-between text-[10px]"><span className="text-slate-400">سندات الاستلام</span><b>{report.purchases.receiptCount}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-slate-400">إجمالي البضاعة</span><b>{money(report.purchases.total)}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-slate-400">المدفوع</span><b className="text-emerald-300">{money(report.purchases.paid)}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-slate-400">المتبقي</span><b className="text-rose-300">{money(report.purchases.due)}</b></div>
            </article>
          </section>

          <section className="grid grid-cols-2 gap-2">
            <article className="print-card rounded-2xl border border-slate-800 bg-slate-900 p-3">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-black text-slate-100"><HandCoins className="h-4 w-4 text-emerald-400" />طرق الدفع</h3>
              {report.paymentMethods.length === 0 ? <p className="text-[10px] text-slate-500">لا توجد مبيعات في الفترة.</p> : report.paymentMethods.map((method) => (
                <div key={method.method} className="flex justify-between border-t border-slate-800 py-1.5 text-[10px] first:border-0">
                  <span>{paymentLabel(method.method)} ({method.orderCount})</span><b>{money(method.amount)}</b>
                </div>
              ))}
            </article>
            <article className="print-card rounded-2xl border border-slate-800 bg-slate-900 p-3">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-black text-slate-100"><ReceiptText className="h-4 w-4 text-amber-400" />المصروفات حسب التصنيف</h3>
              {report.expenses.categories.length === 0 ? <p className="text-[10px] text-slate-500">لا توجد مصروفات في الفترة.</p> : report.expenses.categories.map((category) => (
                <div key={category.category} className="flex justify-between border-t border-slate-800 py-1.5 text-[10px] first:border-0">
                  <span>{category.category} ({category.count})</span><b>{money(category.amount)}</b>
                </div>
              ))}
            </article>
          </section>

          <section className="print-section rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-100"><TrendingUp className="h-4 w-4 text-emerald-400" />الأصناف الأكثر بيعًا</h3>
            {report.topProducts.length === 0 ? (
              <p className="text-[10px] text-slate-500">لا توجد أصناف مباعة خلال الفترة المحددة.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-800">
                <div className="grid grid-cols-[1fr_52px_78px] bg-slate-950 px-2 py-2 text-[9px] font-bold text-slate-500"><span>الصنف</span><span>الطرود</span><span>المبيعات</span></div>
                {report.topProducts.map((product) => (
                  <div key={`${product.sku}-${product.productName}`} className="grid grid-cols-[1fr_52px_78px] border-t border-slate-800 px-2 py-2 text-[10px]">
                    <span className="min-w-0 truncate"><b className="block text-slate-200">{product.productName}</b><small className="text-[8px] text-slate-500">{product.sku}</small></span>
                    <b>{product.packageCount}</b>
                    <span><b className="block">{money(product.revenue)}</b><small className="text-[8px] text-emerald-400">ربح {money(product.profit)}</small></span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <footer className="print-section rounded-xl border border-slate-800 p-3 text-center text-[9px] leading-5 text-slate-500">
            التقرير محتسب من الحركات المحفوظة في Supabase. صافي النتيجة = ربح البيع - المرتجعات + تكلفة المرتجع المعاد للمخزون - المصروفات.
          </footer>
        </main>
      )}
    </div>
  );
};
