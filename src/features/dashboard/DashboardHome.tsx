import {RecentSalesCard} from '../salesHistory/RecentSalesCard';
import type {SalesHistoryReadState} from '../../hooks/useSalesHistory';
import {customerCollectionRows} from '../../utils/customerCollections';
import React, { useState } from 'react';
import { ChevronLeft, PackagePlus, ReceiptText, RefreshCw } from 'lucide-react';
import { Card, KpiCard, KpiGrid, MoneyText, SalesBarChart, SectionHeader, SegmentedControl, StatusBadge, UiButton, formatUiDate, formatUiTime } from '../../components/ui';
import type { HomeDashboardData } from '../../types/dashboard';
import type { Shift } from '../../types';

interface DashboardHomeProps {
  data: HomeDashboardData;
  currentUserName: string;
  currentShift: Shift | null;
  loading: boolean;
  error: string | null;
  realtimeConnected: boolean;
  onRefresh: () => void;
  onOrders: () => void;
  onAccounts: () => void;
  onInventory: () => void;
  onProducts: () => void;
  onShift: () => void;
  onSell: () => void;
  onReceive: (productId?: string) => void;
  onExpense: () => void;
  onCheques?:()=>void;
  salesHistory?:SalesHistoryReadState;
  onSalesHistory?:()=>void;
  onInvoice?:(id:string)=>void;
}

const money = (minor: number | null | undefined, available: boolean) =>
  available && minor != null ? <MoneyText amount={minor / 1000} currency /> : 'غير متاح';

/** Shared live/harness presentation. Fixtures never enter the live loader. */
export const DashboardHome: React.FC<DashboardHomeProps> = ({ data, currentUserName, currentShift, loading, error, realtimeConnected, onRefresh, onOrders, onAccounts, onInventory, onProducts, onShift, onSell, onReceive, onExpense,onCheques,salesHistory,onSalesHistory,onInvoice }) => {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const { summary, financialFactsAvailable: available } = data;
  const collections = summary.todayCollections;
  const collectedAvailable = available && collections != null && summary.todayCashCollectedInMinorUnits === collections.cashInMinorUnits && summary.todayCliqCollectedInMinorUnits === collections.cliqInMinorUnits;
  const collectedValue = loading ? 'جاري التحميل…' : error ? 'تعذر تحميل المقبوض' : money(
    collectedAvailable ? collections.totalInMinorUnits : null, collectedAvailable);
  const collectedNote = loading ? 'جارٍ تحديث التحصيل' : error ? 'أعد المحاولة' : collectedAvailable
    ? <span className="flex flex-wrap gap-x-3 gap-y-1">{customerCollectionRows(collections).map(row=><span key={row.label}>{row.label} {money(row.amount, true)}</span>)}</span>
    : 'تفصيل كاش / CliQ غير متاح في قراءة الرئيسية';
  const days = [...data.sevenDaySales].sort((a, b) => a.date.localeCompare(b.date));
  const date = new Date(data.generatedAt);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const actionCount = data.orderStatuses.filter(item => ['new','confirmed','preparing','processing','ready','out_for_delivery'].includes(item.status)).reduce((sum,item)=>sum+item.count,0);
  const stockIssues = summary.lowStockCount + summary.outOfStockCount + summary.configurationIssuesCount;
  const periodLabel = period === 'day' ? 'مبيعات اليوم' : period === 'week' ? 'مبيعات آخر 7 أيام' : 'مبيعات الشهر';
  const periodSales = period === 'day' ? summary.todaySalesInMinorUnits : period === 'week' ? days.reduce((sum, day) => sum + day.salesInMinorUnits, 0) : summary.monthSalesInMinorUnits;
  const shift = currentShift?.status === 'open' ? currentShift : null;
  const netAvailable = available && days.length > 0 && days.every((day) => day.netSalesInMinorUnits != null);
  return (
    <div dir="rtl" data-testid="dashboard-home" className="min-w-0 bg-nw-bg text-nw-text">
      <section data-testid="dashboard-hero" aria-labelledby="home-title" className="bg-nw-hero px-4 pb-16 pt-5 text-nw-side-text lg:bg-nw-bg lg:px-8 lg:pb-6 lg:pt-8 lg:text-nw-text">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 id="home-title" className="m-0 break-words text-xl font-bold lg:text-2xl">أهلاً {currentUserName || 'بإدارة النواصرة'}</h1>
            <p className="mt-1 text-xs text-nw-side-muted lg:text-nw-muted">{formatUiDate(date, { weekday: 'long', day: 'numeric', month: 'long' })} · مركز اليوم</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="hidden lg:block"><SegmentedControl<'day' | 'week' | 'month'> touchSize label="فترة المبيعات" value={period} onChange={setPeriod} options={[{ value: 'day', label: 'اليوم' }, { value: 'week', label: 'الأسبوع' }, { value: 'month', label: 'الشهر' }]} /></div>
            <UiButton aria-label="تحديث مركز اليوم" disabled={loading} onClick={onRefresh}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></UiButton>
          </div>
        </div>
        <div className="mt-5 lg:hidden" data-testid="home-mobile-sales">
          <p className="text-sm text-nw-side-muted">{periodLabel}</p>
          <div className="mt-1 break-words text-4xl font-bold">{available ? <><MoneyText amount={periodSales / 1000} /> <span className="text-sm font-normal text-nw-side-muted">د.أ</span></> : 'غير متاح'}</div>
          <p className="mt-2 text-xs text-nw-side-muted">{summary.todayCompletedOrders} طلب مكتمل اليوم · {realtimeConnected ? 'تحديث مباشر' : 'آخر نسخة محمّلة'}</p>
        </div>
      </section>

      <div className="relative -mt-10 space-y-5 px-4 pb-8 lg:mt-0 lg:px-8">
        {error && <p role="alert" className="rounded-xl bg-nw-bad-bg p-3 text-sm text-nw-bad">تعذر التحديث: {error}</p>}
        {!available && <p role="status" className="rounded-xl bg-nw-warn-bg p-3 text-sm text-nw-warn">الأرقام المالية غير متاحة حالياً؛ أعد المحاولة أو راجع التقارير.</p>}
        <div data-testid="home-kpis">
        <KpiGrid phonePairs className="lg:hidden">
          <KpiCard label="طلبات اليوم" value={summary.todayCompletedOrders} note={`${summary.newOrdersCount} طلب جديد`} />
          <KpiCard label="المقبوض اليوم" value={collectedValue} note={collectedNote} className="[&>div:nth-child(2)]:text-xl" />
          <KpiCard label="ذمم العملاء" value={money(summary.customerReceivablesInMinorUnits, available)} className="[&>div:nth-child(2)]:text-xl" />
          <KpiCard label="تنبيهات المخزون" value={stockIssues} note="أصناف تحتاج متابعة" />
        </KpiGrid>
        <KpiGrid className="hidden lg:grid">
          <KpiCard label={periodLabel} value={money(periodSales, available)} note={`${summary.todayCompletedOrders} طلب مكتمل اليوم`} className="[&>div:nth-child(2)]:text-xl xl:[&>div:nth-child(2)]:text-2xl" />
          <KpiCard label="صافي الشهر" value={money(summary.monthNetSalesInMinorUnits, available)} note="بعد استحقاق المرتجعات" className="[&>div:nth-child(2)]:text-xl xl:[&>div:nth-child(2)]:text-2xl" />
          <KpiCard label="المقبوض اليوم" value={collectedValue} note={collectedNote} className="[&>div:nth-child(2)]:text-xl" />
          <KpiCard label="ذمم العملاء" value={money(summary.customerReceivablesInMinorUnits, available)} note={<button type="button" className="min-h-11 text-right text-nw-primary" onClick={onAccounts}>مراجعة العملاء والذمم</button>} className="[&>div:nth-child(2)]:text-xl xl:[&>div:nth-child(2)]:text-2xl" />
        </KpiGrid>
        </div>

        {data.chequeAlerts&&(data.chequeAlerts.due>0||data.chequeAlerts.overdue>0)&&<Card className="space-y-2" data-testid="home-cheque-alert">
          <SectionHeader title="مواعيد الشيكات" action={onCheques&&<UiButton onClick={onCheques}>فتح الشيكات</UiButton>} />
          <p className="m-0 text-sm">خلال يومين: <bdi>{data.chequeAlerts.due}</bdi> · متأخرة: <bdi>{data.chequeAlerts.overdue}</bdi></p>
          <p className="m-0 text-sm text-nw-muted">تأكد من كفاية رصيد الشيكات الصادرة: <MoneyText amount={data.chequeAlerts.outgoingDue/1000} currency /></p>
        </Card>}
        {actionCount>0&&<button onClick={onOrders} className="flex min-h-11 items-center gap-2 text-sm font-semibold text-nw-primary">طلبات تحتاج إجراء: {actionCount}<ChevronLeft className="h-4 w-4" aria-hidden="true"/></button>}
        <div className="flex flex-wrap items-stretch gap-5">
          {salesHistory&&<RecentSalesCard state={salesHistory} onOpen={id=>onInvoice?.(id)} onViewAll={()=>onSalesHistory?.()}/>}

          <Card aria-labelledby="home-shift-title" className="order-1 min-w-0 flex-[1_1_280px] lg:order-2">
            <SectionHeader id="home-shift-title" title="الوردية الحالية" action={<StatusBadge tone={shift ? 'ok' : 'mute'}>{shift ? 'مفتوحة' : 'لا توجد وردية مفتوحة'}</StatusBadge>} />
            {shift ? <>
              <div className="mt-4 lg:hidden">
                <div className="flex items-center justify-between gap-3"><span className="text-sm text-nw-muted">النقد المتوقع بالصندوق</span><MoneyText amount={shift.expectedCash} className="text-2xl font-bold" /></div>
                <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-nw-border pt-3 text-center text-xs">
                  <div><dt className="text-nw-muted">مبيعات كاش</dt><dd className="m-0 mt-1 font-bold"><MoneyText amount={shift.totalCashSales} /></dd></div>
                  <div><dt className="text-nw-muted">الرصيد الافتتاحي</dt><dd className="m-0 mt-1 font-bold"><MoneyText amount={shift.openingCash} /></dd></div>
                  <div><dt className="text-nw-muted">بداية الوردية</dt><dd className="m-0 mt-1 font-bold"><bdi dir="ltr">{formatUiTime(shift.startTime)}</bdi></dd></div>
                </dl>
              </div>
              <dl data-testid="home-shift-flows" className="mt-4 space-y-3 text-sm">
                {[
                  ['الرصيد الافتتاحي', shift.openingCash], ['مبيعات كاش', shift.totalCashSales],
                  ['سندات قبض كاش', shift.cashReceipts], ['مرتجعات مدفوعة كاش', -shift.cashRefunds],
                  ['مصروفات من الدرج', -shift.cashExpenses],
                  ['دفعات موردين من الدرج', -shift.cashSupplierPayments],
                  ...(shift.ownerWithdrawals !== undefined ? [['سحوبات المالك', -shift.ownerWithdrawals]] : []),
                  ...(shift.ownerWithdrawalReturns !== undefined ? [['إرجاع سحوبات المالك', shift.ownerWithdrawalReturns]] : []),
                ].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between gap-3"><dt className="text-nw-muted">{label}</dt><dd className="m-0"><MoneyText amount={Number(value)} /></dd></div>)}
                <div className="flex items-center justify-between gap-3 rounded-xl bg-nw-surface-2 p-3"><dt>النقد المتوقع بالصندوق</dt><dd className="m-0 text-xl font-bold"><MoneyText amount={shift.expectedCash} /></dd></div>
              </dl>
              <UiButton className="mt-4 w-full" onClick={onShift}>إغلاق الوردية</UiButton>
            </> : <><p className="my-6 text-sm text-nw-muted">افتح الوردية من الصندوق لتسجيل الحركات النقدية.</p><UiButton className="w-full" onClick={onShift}>فتح الصندوق والورديات</UiButton></>}
          </Card>
        </div>

        <div className="flex flex-wrap items-stretch gap-5">
          <Card aria-labelledby="home-sales-title" className="min-w-0 flex-[2_1_520px]">
            <SectionHeader id="home-sales-title" title="صافي المبيعات — آخر 7 أيام" hint="بعد استحقاق المرتجعات" />
            <div className="mt-5">{netAvailable ? <SalesBarChart label="صافي المبيعات آخر 7 أيام" points={days.map((day) => ({ id: day.date, label: day.date === today ? 'اليوم' : formatUiDate(`${day.date}T12:00:00+03:00`, { weekday: 'long' }), amount: day.netSalesInMinorUnits! / 1000, current: day.date === today }))} /> : <p className="py-12 text-center text-nw-muted">غير متاح</p>}</div>
          </Card>
          <Card aria-labelledby="home-stock-title" className="min-w-0 flex-[1_1_280px]">
            <SectionHeader id="home-stock-title" title="تنبيهات المخزون" action={<span className="flex items-center gap-2"><StatusBadge tone={stockIssues ? 'warn' : 'ok'}>{stockIssues}</StatusBadge><UiButton onClick={onInventory}>المخزون</UiButton></span>} hint="الجاهزية محسوبة حسب طرد البيع" />
            <div className="mt-4 space-y-2">
              {data.stockAlerts.slice(0, 5).map((item) => <div key={item.id} className="rounded-xl bg-nw-surface-2 p-3">
                <div className="flex items-start justify-between gap-2"><p className="min-w-0 break-words text-sm font-semibold">{item.nameAr}</p><StatusBadge tone={item.severity === 'configuration' ? 'info' : item.severity === 'out_of_stock' ? 'bad' : 'warn'}>{item.severity === 'configuration' ? 'إعداد' : item.severity === 'out_of_stock' ? 'نفد' : 'منخفض'}</StatusBadge></div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-nw-muted">{item.severity === 'configuration' ? 'أكمل بيانات طرد البيع والسعر' : `${item.availableSalePackages} ${item.saleUnitName} متاح`}</p><UiButton onClick={() => item.severity === 'configuration' ? onProducts() : onReceive(item.id)}>{item.severity === 'configuration' ? 'ضبط' : 'استلام'}</UiButton></div>
              </div>)}
              {!stockIssues && <p className="py-6 text-sm text-nw-muted">المخزون جاهز؛ لا توجد تنبيهات.</p>}
            </div>
          </Card>
        </div>
        {summary.monthOwnerWithdrawalsInMinorUnits !== undefined && <Card data-testid="home-owner-withdrawals">
          <SectionHeader title="سحوبات المالك — هذا الشهر" hint="كل الفروع، بنفس نطاق ربح الشهر" />
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><dt className="text-xs text-nw-muted">صافي السحوبات</dt><dd className="m-0 text-xl font-bold text-nw-bad">{money(summary.monthOwnerWithdrawalsInMinorUnits, true)}</dd></div>
            <div><dt className="text-xs text-nw-muted">المتبقي في المحل</dt><dd className="m-0"><span className="text-xl font-bold">{money(summary.monthRemainingAfterWithdrawalsInMinorUnits ?? null, available)}</span>
              <p className="m-0 mt-1 text-xs text-nw-muted">ربح الشهر ناقص صافي السحوبات؛ ليس رصيد الدرج أو البنك.</p></dd></div>
          </dl>
        </Card>}
        <Card>
          <SectionHeader title="إجراءات سريعة" />
          <div className="mt-3 flex flex-wrap gap-3"><UiButton onClick={onSell}>بيع جديد</UiButton><UiButton onClick={() => onReceive()}><PackagePlus className="h-4 w-4" aria-hidden="true" />استلام بضاعة</UiButton><UiButton onClick={onExpense}><ReceiptText className="h-4 w-4" aria-hidden="true" />تسجيل مصروف</UiButton></div>
          <details className="mt-4 text-sm"><summary className="min-h-11 cursor-pointer text-nw-muted">تفاصيل إضافية</summary><dl className="space-y-2 text-nw-muted"><div>ذمم الموردين: {money(summary.supplierPayablesInMinorUnits, available)}</div>{summary.supplierAdvancesInMinorUnits !== undefined && <div>دفعات مقدّمة للموردين: {money(summary.supplierAdvancesInMinorUnits, available)}</div>}<div>عدد العملاء المتأخرين: غير متاح في قراءة الرئيسية</div>{data.access.canViewProfit && <div>ربح الشهر: {money(summary.monthProfitInMinorUnits, available)}</div>}</dl></details>
        </Card>
        {summary.activeProductsCount === 0 && summary.activeCustomersCount === 0 && data.latestOrders.length === 0 && <Card><SectionHeader title="ابدأ بإضافة أول صنف" hint="بعدها استلم الكميات، وستظهر المتابعة اليومية هنا تلقائياً." /><UiButton className="mt-3" onClick={onProducts}>إضافة صنف</UiButton></Card>}
      </div>
    </div>
  );
};
