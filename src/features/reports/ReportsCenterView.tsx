import {CustomerCollectionsSection} from './CustomerCollectionsSection';
import {DamageLossReportSection} from './DamageLossReportSection';
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
import {
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import type { OperationalBusinessReport } from '../../types';
import { OwnerWithdrawalsReportSection } from './OwnerWithdrawalsReportSection';
import type {AftercareIntegrityStatus} from '../../types/monitoring';
import {getAftercareIntegrityStatus} from '../../services/supabase/monitoring.service';
import {aftercareIntegrityWarning} from '../../utils/aftercareIntegrity';
import {Card, FormFields, UiButton, DataTable, Th, Tr, Td, formatJod, formatUiDate} from '../../components/ui';

const pad = (value: number) => String(value).padStart(2, '0');
const localDateValue = (value: Date) =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

const todayValue = () => localDateValue(new Date());
const monthStartValue = () => {
  const today = new Date();
  return localDateValue(new Date(today.getFullYear(), today.getMonth(), 1));
};

const money = (value: number) => `${formatJod(value)} ${CURRENCY}`;

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
    blue: 'border-nw-border bg-nw-info-bg text-nw-info',
    emerald: 'border-nw-border bg-nw-ok-bg text-nw-ok',
    amber: 'border-nw-border bg-nw-warn-bg text-nw-warn',
    rose: 'border-nw-border bg-nw-bad-bg text-nw-bad',
    cyan: 'border-nw-border bg-nw-info-bg text-nw-info',
    violet: 'border-nw-border bg-nw-info-bg text-nw-info',
  };

  return (
    <article className="print-card min-w-0">
      <Card className="h-full">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="block text-[10px] font-bold text-nw-muted">{label}</span>
          <strong className="nw-num mt-1 block text-xl font-bold"><bdi dir="ltr">{value}</bdi></strong>
        </div>
        <Icon className={`h-4 w-4 shrink-0 ${tones[tone]}`} />
      </div>
      <p className="mt-1 text-[9px] leading-4 text-nw-muted">{hint}</p>
      </Card>
    </article>
  );
};

export const ReportsCenterView: React.FC = () => {
  const activeBranch = useAppStoreSelector((state) => state.activeBranch);
  const { setToast } = useAppStoreActions();
  const [dateFrom, setDateFrom] = useState(monthStartValue);
  const [dateTo, setDateTo] = useState(todayValue);
  const [report, setReport] = useState<OperationalBusinessReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [integrity, setIntegrity] = useState<AftercareIntegrityStatus | null>(null);
  const [integrityNow, setIntegrityNow] = useState(Date.now);
  const integrityWarning = aftercareIntegrityWarning(integrity, integrityNow);

  useEffect(() => {
    const timer = window.setInterval(() => setIntegrityNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadReport = useCallback(async () => {
    if (!activeBranch.id) return;
    if (!dateFrom || !dateTo || dateTo < dateFrom) {
      setError('اختر فترة صحيحة: تاريخ النهاية يجب ألا يسبق البداية.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const [nextReport, monitoring] = await Promise.all([
        fetchOperationalBusinessReportFromSupabase(activeBranch.id, dateFrom, dateTo),
        getAftercareIntegrityStatus().catch(() => null),
      ]);
      setIntegrity(monitoring);
      setIntegrityNow(Date.now());
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
  }, [loadReport]);

  const setPreset = (days: number | 'month') => {
    const end = new Date();
    const start =
      days === 'month'
        ? new Date(end.getFullYear(), end.getMonth(), 1)
        : new Date(end.getFullYear(), end.getMonth(), end.getDate() - days + 1);
    setDateFrom(localDateValue(start));
    setDateTo(localDateValue(end));
  };

  // A closed <details> is not printed by browsers. Open every report details
  // section before printing, from the button and from the browser's own print.
  const openReportDetails = () => {
    document
      .querySelectorAll<HTMLDetailsElement>('details[data-testid="report-details"]')
      .forEach((details) => { details.open = true; });
  };

  useEffect(() => {
    window.addEventListener('beforeprint', openReportDetails);
    return () => window.removeEventListener('beforeprint', openReportDetails);
  }, []);

  const handlePrint = () => {
    if (!report) {
      setToast('حمّل التقرير أولاً قبل الطباعة أو الحفظ PDF.', 'error');
      return;
    }
    openReportDetails();
    window.print();
  };

  return (
    <div data-testid="reports-screen" className="nw-batch4-report space-y-4 p-4 pb-24 text-nw-text">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 11mm; }
          html, body { background: var(--nw-print-surface) !important; }
          body * { visibility: hidden !important; }
          .operational-report-print,
          .operational-report-print * { visibility: visible !important; }
          .operational-report-print {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            color: var(--nw-print-text) !important;
            background: var(--nw-print-surface) !important;
            font-family: var(--font-sans) !important;
            direction: rtl !important;
          }
          .operational-report-print * {
            color: var(--nw-print-text) !important;
            background: transparent !important;
            box-shadow: none !important;
          }
          .operational-report-print .print-card,
          .operational-report-print .print-section {
            border: 1px solid var(--nw-print-border) !important;
            break-inside: avoid;
          }
          .report-screen-actions { display: none !important; }
        }
      `}</style>

      <div className="report-screen-actions space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black text-nw-text">
              <BarChart3 className="h-5 w-5 text-nw-info" />
              التقارير والحسابات
            </h2>
            <p className="text-[11px] text-nw-muted">
              أرقام فعلية من المبيعات والمخزون والمصروفات والموردين
            </p>
          </div>
          <UiButton variant="primary"
            type="button"
            onClick={handlePrint}
            disabled={!report || isLoading}
            className="shrink-0 whitespace-nowrap text-xs"
          >
            <FileDown className="h-4 w-4" />
            طباعة / PDF
          </UiButton>
        </div>

        <Card>
        <FormFields className="nw-batch4-fields space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[10px] font-bold text-nw-muted">
              <span>من تاريخ</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => setDateFrom(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 py-2 text-xs text-nw-text"
              />
            </label>
            <label className="space-y-1 text-[10px] font-bold text-nw-muted">
              <span>إلى تاريخ</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                max={todayValue()}
                onChange={(event) => setDateTo(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 py-2 text-xs text-nw-text"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <UiButton variant="plain" type="button" onClick={() => setPreset(1)} className="shrink-0 rounded-lg bg-nw-surface px-2.5 py-1.5 text-[10px] font-bold text-nw-muted">اليوم</UiButton>
            <UiButton variant="plain" type="button" onClick={() => setPreset(7)} className="shrink-0 rounded-lg bg-nw-surface px-2.5 py-1.5 text-[10px] font-bold text-nw-muted">آخر 7 أيام</UiButton>
            <UiButton variant="plain" type="button" onClick={() => setPreset(30)} className="shrink-0 rounded-lg bg-nw-surface px-2.5 py-1.5 text-[10px] font-bold text-nw-muted">آخر 30 يومًا</UiButton>
            <UiButton variant="plain" type="button" onClick={() => setPreset('month')} className="shrink-0 rounded-lg bg-nw-surface px-2.5 py-1.5 text-[10px] font-bold text-nw-muted">هذا الشهر</UiButton>
          </div>
          <UiButton variant="accent"
            type="button"
            onClick={() => void loadReport()}
            disabled={isLoading}
            className="w-full text-sm"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isLoading ? 'جاري احتساب التقرير...' : 'تحديث التقرير'}
          </UiButton>
        </FormFields>
        </Card>
      </div>

      {error && (
        <section className="flex items-start gap-2 rounded-2xl border border-nw-border bg-nw-bad-bg p-4 text-xs leading-6 text-nw-bad">
          <CircleAlert className="mt-1 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <UiButton variant="plain" type="button" onClick={() => void loadReport()} className="mt-2 font-black underline">إعادة المحاولة</UiButton>
          </div>
        </section>
      )}

      {isLoading && !report && !error && (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-nw-muted">
          <Loader2 className="h-8 w-8 animate-spin text-nw-info" />
          <span className="text-xs font-bold">جاري تحميل التقرير...</span>
        </div>
      )}

      {report && (
        <main className="operational-report-print space-y-4" dir="rtl">
          {integrityWarning && (
            <div role="alert" data-testid="aftercare-integrity-warning"
              className="rounded-xl border border-nw-border bg-nw-warn-bg p-3 text-sm text-nw-warn">
              {integrityWarning}
            </div>
          )}
          <header className="print-section rounded-2xl border border-nw-border bg-nw-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black text-nw-info">مؤسسة نواصرة التجارية</p>
                <h1 className="mt-1 text-base font-black text-nw-text">التقرير المالي والتشغيلي</h1>
                <p className="mt-1 text-[10px] text-nw-muted">{report.period.branchName}</p>
              </div>
              <div className="text-left text-[10px] leading-5 text-nw-muted">
                <span className="block">من {formatUiDate(report.period.dateFrom, {year:'numeric',month:'short',day:'numeric'})}</span>
                <span className="block">إلى {formatUiDate(report.period.dateTo, {year:'numeric',month:'short',day:'numeric'})}</span>
                <span className="block">أنشئ: {formatUiDate(report.generatedAt, {dateStyle:'medium',timeStyle:'short'})}</span>
              </div>
            </div>
          </header>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="المبيعات" value={money(report.sales.grossSales)} hint="مبيعات الفترة بعد الخصم، قبل المرتجعات" icon={ShoppingCart} tone="blue" />
            <MetricCard label="المرتجعات" value={money(report.sales.returnEntitlement)} hint="خفض الذمة والمبلغ المسترد معًا" icon={PackageCheck} tone="rose" />
            <MetricCard label="صافي المبيعات" value={money(report.sales.netSales)} hint="المبيعات ناقص استحقاق المرتجعات" icon={ShoppingCart} tone="blue" />
            <MetricCard label="المقبوض — كاش" value={money(report.cashFlow.cashCollected)} hint="تحصيل الفترة بعد عكس الدفعات، قبل الرد" icon={Banknote} tone="emerald" />
            <MetricCard label="المقبوض — CliQ" value={money(report.cashFlow.cliqCollected)} hint="تحصيل الفترة بعد عكس الدفعات، قبل الرد" icon={Banknote} tone="cyan" />
            <MetricCard label="المصاري المرجّعة" value={money(report.sales.refunds)} hint="كاش وCliQ؛ لا تشمل خفض الذمة" icon={HandCoins} tone="rose" />
            <MetricCard label="الذمم" value={money(report.balances.customerDue)} hint="رصيد العملاء الحالي وقت قراءة التقرير" icon={Users} tone="rose" />
            <MetricCard label="المصاريف" value={money(report.expenses.total)} hint="المصاريف غير المعكوسة خلال الفترة" icon={ReceiptText} tone="amber" />
            <MetricCard label="الربح" value={money(report.sales.netProfit)} hint="بعد المرتجعات والاستبدال واسترجاع التكلفة والمصاريف والتلف" icon={TrendingUp} tone={report.sales.netProfit >= 0 ? 'emerald' : 'rose'} />
          </section>

          <DamageLossReportSection losses={report.sales.damageLosses} />
          <CustomerCollectionsSection collections={report.cashFlow.customerCollections} />

          {report.ownerWithdrawals && (
            <OwnerWithdrawalsReportSection branchId={activeBranch.id} dateFrom={dateFrom} dateTo={dateTo}
              totals={report.ownerWithdrawals} onChanged={() => void loadReport()} />
          )}

          <details className="space-y-4" data-testid="report-details">
            <summary className="cursor-pointer rounded-xl border border-nw-border bg-nw-surface p-3 font-bold text-nw-text">تفاصيل</summary>
            <section className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard label="ذمم الموردين" value={money(report.balances.supplierDue)} hint={`${report.balances.supplierCount} مورد لهم رصيد`} icon={Truck} tone="violet" />
              {report.balances.supplierAdvances !== undefined && <MetricCard label="دفعات مقدّمة للموردين" value={money(report.balances.supplierAdvances)} hint="أرصدة سالبة منفصلة؛ لا تُخصم من ذمم موردين آخرين" icon={Truck} tone="emerald" />}
              <MetricCard label="تكلفة البيع الأصلية" value={money(report.sales.cogs)} hint="COGS التاريخي لا يعاد تسعيره" icon={Boxes} tone="blue" />
              <MetricCard label="تكلفة الاستبدال" value={money(report.sales.replacementCost)} hint="من تكلفة الإصدار المحفوظة" icon={Boxes} tone="amber" />
              <MetricCard label="استرجاع التكلفة" value={money(report.sales.restockRecovery)} hint="للمخزون القابل للبيع فقط، بتكلفة القطعة الحالية التاريخية" icon={PackageCheck} tone="emerald" />
              <MetricCard label="خفض الذمم بالمرتجعات" value={money(report.sales.debtReduction)} hint="ليس حركة كاش أو CliQ" icon={Users} tone="cyan" />
              <MetricCard label="هامش البيع الأصلي" value={money(report.sales.grossProfit)} hint="البضاعة بعد الخصم ناقص تكلفتها؛ دون التوصيل" icon={TrendingUp} tone="emerald" />
              <MetricCard label="هامش ما بعد البيع" value={money(report.sales.aftercareAdjustedMargin)} hint="يشمل التوصيل؛ قبل المصاريف" icon={TrendingUp} tone="violet" />
              <MetricCard label="صافي حركة الكاش" value={money(report.cashFlow.cashNetFlow)} hint="المقبوض بعد العكس ناقص المصاري المرجّعة" icon={Banknote} tone="cyan" />
              <MetricCard label="صافي حركة CliQ" value={money(report.cashFlow.cliqNetFlow)} hint="المقبوض بعد العكس ناقص المصاري المرجّعة" icon={Banknote} tone="cyan" />
            </section>
          <section className="print-section space-y-3 rounded-2xl border border-nw-border bg-nw-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-black text-nw-text">
                <Activity className="h-4 w-4 text-nw-info" />
                حركة المخزون خلال الفترة
              </h3>
              <span className="text-[9px] font-bold text-nw-muted">
                {report.inventoryMovements.affectedProducts} صنف متأثر
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="print-card rounded-xl border border-nw-border bg-nw-ok-bg p-2">
                <ArrowDownToLine className="mx-auto h-4 w-4 text-nw-ok" />
                <b className="mt-1 block text-sm text-nw-ok">+{report.inventoryMovements.unitsIn}</b>
                <span className="text-[8px] text-nw-muted">وحدات داخلة</span>
              </div>
              <div className="print-card rounded-xl border border-nw-border bg-nw-bad-bg p-2">
                <ArrowUpFromLine className="mx-auto h-4 w-4 text-nw-bad" />
                <b className="mt-1 block text-sm text-nw-bad">-{report.inventoryMovements.unitsOut}</b>
                <span className="text-[8px] text-nw-muted">وحدات خارجة</span>
              </div>
              <div className="print-card rounded-xl border border-nw-border bg-nw-info-bg p-2">
                <Activity className="mx-auto h-4 w-4 text-nw-info" />
                <b className="mt-1 block text-sm text-nw-info">{report.inventoryMovements.netUnits > 0 ? '+' : ''}{report.inventoryMovements.netUnits}</b>
                <span className="text-[8px] text-nw-muted">صافي التغير</span>
              </div>
            </div>
            {report.inventoryMovements.types.length === 0 ? (
              <p className="text-[10px] text-nw-muted">لا توجد حركات مخزون خلال الفترة المحددة.</p>
            ) : (
              <DataTable caption="تفصيل حركات المخزون">
                <thead><Tr><Th>نوع الحركة</Th><Th>العدد</Th><Th>داخل</Th><Th>خارج</Th></Tr></thead>
                <tbody>
                {report.inventoryMovements.types.map((movement) => (
                  <Tr key={movement.movementType}><Td>{movementLabel(movement.movementType)}</Td><Td>{movement.movementCount}</Td><Td className="text-nw-ok">{movement.unitsIn}</Td><Td className="text-nw-bad">{movement.unitsOut}</Td></Tr>
                ))}
                </tbody>
              </DataTable>
            )}
            {report.inventoryMovements.topProducts.length > 0 && (
              <div>
                <h4 className="mb-2 text-[10px] font-black text-nw-muted">أكثر الأصناف حركة</h4>
                <div className="grid gap-1.5">
                  {report.inventoryMovements.topProducts.slice(0, 5).map((product) => (
                    <div key={`${product.sku}-${product.productName}`} className="flex items-center justify-between rounded-lg border border-nw-border px-2 py-1.5 text-[9px]">
                      <span className="min-w-0 truncate"><b>{product.productName}</b> <small className="text-nw-muted">{product.sku}</small></span>
                      <span className="shrink-0 text-nw-muted">+{product.unitsIn} / -{product.unitsOut}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="print-section space-y-3 rounded-2xl border border-nw-border bg-nw-surface p-4">
            <h3 className="flex items-center gap-2 text-sm font-black text-nw-text"><ShoppingCart className="h-4 w-4 text-nw-info" />تفاصيل المبيعات والربح</h3>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm md:grid-cols-2">
              <div className="flex justify-between"><span className="text-nw-muted">إجمالي المبيعات</span><b>{money(report.sales.grossSales)}</b></div>
              <div className="flex justify-between"><span className="text-nw-muted">المصاري المرجّعة</span><b className="text-nw-bad">{money(report.sales.refunds)}</b></div>
              <div className="flex justify-between"><span className="text-nw-muted">الخصومات</span><b>{money(report.sales.discount)}</b></div>
              <div className="flex justify-between"><span className="text-nw-muted">رسوم التوصيل</span><b>{money(report.sales.deliveryFees)}</b></div>
              <div className="flex justify-between"><span className="text-nw-muted">تغطية تحصيل طلبات الفترة حاليًا</span><b className="text-nw-ok">{money(report.sales.collected)}</b></div>
              <div className="flex justify-between"><span className="text-nw-muted">الذمة الحالية لطلبات الفترة</span><b className="text-nw-warn">{money(report.sales.outstanding)}</b></div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-nw-border pt-3 text-center text-xs md:grid-cols-4">
              <div><b className="block text-sm text-nw-text">{report.sales.posOrderCount}</b><span className="text-nw-muted">بيع مباشر</span></div>
              <div><b className="block text-sm text-nw-text">{report.sales.websiteOrderCount}</b><span className="text-nw-muted">طلبات موقع</span></div>
              <div><b className="block text-sm text-nw-text">{report.sales.packageCount}</b><span className="text-nw-muted">طرد مباع</span></div>
              <div><b className="block text-sm text-nw-text">{report.sales.uniqueProductCount}</b><span className="text-nw-muted">صنف مختلف</span></div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <article className="print-card space-y-2 rounded-2xl border border-nw-border bg-nw-surface p-3">
              <h3 className="flex items-center gap-2 text-xs font-black text-nw-text"><PackageCheck className="h-4 w-4 text-nw-info" />المخزون الحالي</h3>
              <div className="flex justify-between text-[10px]"><span className="text-nw-muted">قيمة التكلفة</span><b>{money(report.inventory.value)}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-nw-muted">أصناف لها رصيد</span><b>{report.inventory.stockedProducts}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-nw-muted">باكيتات فعلية / محجوزة</span><b>{report.inventory.baseUnitsOnHand} / {report.inventory.baseUnitsReserved}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-nw-muted">قربت تنفد</span><b className="text-nw-warn">{report.inventory.lowStockProducts}</b></div>
            </article>
            <article className="print-card space-y-2 rounded-2xl border border-nw-border bg-nw-surface p-3">
              <h3 className="flex items-center gap-2 text-xs font-black text-nw-text"><Boxes className="h-4 w-4 text-nw-info" />مشتريات الموردين</h3>
              <div className="flex justify-between text-[10px]"><span className="text-nw-muted">سندات الاستلام</span><b>{report.purchases.receiptCount}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-nw-muted">إجمالي البضاعة</span><b>{money(report.purchases.total)}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-nw-muted">المدفوع</span><b className="text-nw-ok">{money(report.purchases.paid)}</b></div>
              <div className="flex justify-between text-[10px]"><span className="text-nw-muted">المتبقي</span><b className="text-nw-bad">{money(report.purchases.due)}</b></div>
            </article>
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <article className="print-card rounded-2xl border border-nw-border bg-nw-surface p-3">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-black text-nw-text"><HandCoins className="h-4 w-4 text-nw-ok" />طرق الدفع</h3>
              {report.paymentMethods.length === 0 ? <p className="text-[10px] text-nw-muted">لا توجد مبيعات في الفترة.</p> : report.paymentMethods.map((method) => (
                <div key={method.method} className="flex justify-between border-t border-nw-border py-1.5 text-[10px] first:border-0">
                  <span>{paymentLabel(method.method)} ({method.orderCount})</span><b>{money(method.amount)}</b>
                </div>
              ))}
            </article>
            <article className="print-card rounded-2xl border border-nw-border bg-nw-surface p-3">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-black text-nw-text"><ReceiptText className="h-4 w-4 text-nw-warn" />المصروفات حسب التصنيف</h3>
              {report.expenses.categories.length === 0 ? <p className="text-[10px] text-nw-muted">لا توجد مصروفات في الفترة.</p> : report.expenses.categories.map((category) => (
                <div key={category.category} className="flex justify-between border-t border-nw-border py-1.5 text-[10px] first:border-0">
                  <span>{category.category} ({category.count})</span><b>{money(category.amount)}</b>
                </div>
              ))}
            </article>
          </section>

          <section className="print-section rounded-2xl border border-nw-border bg-nw-surface p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-nw-text"><TrendingUp className="h-4 w-4 text-nw-ok" />الأصناف الأكثر بيعًا</h3>
            {report.topProducts.length === 0 ? (
              <p className="text-[10px] text-nw-muted">لا توجد أصناف مباعة خلال الفترة المحددة.</p>
            ) : (
              <DataTable caption="الأصناف الأكثر بيعاً">
                <thead><Tr><Th>الصنف</Th><Th>الطرود</Th><Th>المبيعات</Th></Tr></thead><tbody>
                {report.topProducts.map((product) => (
                  <Tr key={`${product.sku}-${product.productName}`}><Td><b className="block text-nw-text">{product.productName}</b><small className="text-xs text-nw-muted">{product.sku}</small></Td><Td>{product.packageCount}</Td><Td><bdi dir="ltr" className="nw-num block whitespace-nowrap">{money(product.revenue)}</bdi><small className="text-xs text-nw-ok">ربح <bdi dir="ltr" className="nw-num">{money(product.profit)}</bdi></small></Td></Tr>
                ))}
                </tbody>
              </DataTable>
            )}
          </section>

          <footer className="print-section rounded-xl border border-nw-border p-3 text-center text-[9px] leading-5 text-nw-muted">
            الربح = صافي المبيعات − تكلفة البيع الأصلية − تكلفة الاستبدال + استرجاع تكلفة المخزون − المصاريف. التوصيل مبيّن مستقلًا ولا يرد مع المرتجع الحديث. حركات الفترة لا تساوي بالضرورة تحصيل طلبات الفترة.
          </footer>
          </details>
        </main>
      )}
    </div>
  );
};
