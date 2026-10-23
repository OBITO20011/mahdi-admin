import {CashFlowSummary} from '../shifts/CashFlowSummary';
import {SupplierReplacementSummary} from '../inventory/SupplierReplacementSummary';
import {RecentSalesCard} from '../salesHistory/RecentSalesCard';
import type {SalesHistoryReadState} from '../../hooks/useSalesHistory';
import {customerCollectionRows} from '../../utils/customerCollections';
import React, { useState } from 'react';
import { ChevronLeft, PackagePlus, ReceiptText, RefreshCw } from 'lucide-react';
import { Card, KpiCard, KpiGrid, MoneyText, SalesBarChart, SectionHeader, SegmentedControl, StatusBadge, UiButton, formatUiDate } from '../../components/ui';
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
      <section data-testid="dashboard-hero" aria-labelledby="home-title" className="px-4 pb-3 pt-3 lg:px-8 lg:pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><h1 id="home-title" className="m-0 break-words text-lg font-bold lg:text-2xl">أهلاً {currentUserName || 'بإدارة النواصرة لتجارة الجملة والمواد الغذائية'}</h1>
            <p className="mt-1 text-xs text-nw-muted">{formatUiDate(date, {weekday:'long',day:'numeric',month:'long'})} · مركز اليوم · {realtimeConnected?'تحديث مباشر':'آخر نسخة محمّلة'}</p></div>
          <UiButton aria-label="تحديث مركز اليوم" disabled={loading} onClick={onRefresh}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading?'animate-spin':''}`}/></UiButton>
        </div>
        <div className="mt-2"><SegmentedControl<'day'|'week'|'month'> touchSize label="فترة المبيعات" value={period} onChange={setPeriod} options={[{value:'day',label:'اليوم'},{value:'week',label:'الأسبوع'},{value:'month',label:'الشهر'}]}/></div>
      </section>
      <div className="space-y-3 px-4 pb-8 lg:space-y-5 lg:px-8">
        {error&&<p role="alert" className="rounded-xl bg-nw-bad-bg p-3 text-sm text-nw-bad">تعذر التحديث: {error}</p>}
        {!available&&!loading&&!error&&<p role="status" className="rounded-xl bg-nw-warn-bg p-3 text-sm text-nw-warn">الأرقام المالية غير متاحة حالياً؛ أعد المحاولة أو راجع التقارير.</p>}
        <div data-testid="home-kpis">
          <KpiGrid phonePairs className="[&>article]:p-3 [&>div]:p-3 [&_p]:my-0">
            <KpiCard label={periodLabel} value={loading?'جاري التحميل…':error?'تعذر التحميل':money(periodSales,available)} note={`${summary.todayCompletedOrders} طلب مكتمل اليوم`} className="[&>div:nth-child(2)]:text-xl"/>
            <KpiCard label="ربح الشهر" value={loading?'جاري التحميل…':error?'تعذر التحميل':money(summary.monthProfitInMinorUnits,available&&data.access.canViewProfit)} note={data.access.canViewProfit?'حسب الربح المحسوب في النظام':'بحسب صلاحية الربح'} className="[&>div:nth-child(2)]:text-xl"/>
            <KpiCard label="المقبوض اليوم" value={collectedValue} note={collectedNote} className="[&>div:nth-child(2)]:text-xl"/>
            <KpiCard label="ذمم العملاء" value={loading?'جاري التحميل…':error?'تعذر التحميل':money(summary.customerReceivablesInMinorUnits,available)} note={<button type="button" className="min-h-11 text-right text-nw-primary" onClick={onAccounts}>مراجعة الذمم</button>} className="[&>div:nth-child(2)]:text-xl"/>
          </KpiGrid>
        </div>
        <section aria-labelledby="home-shift-title" className="rounded-xl border border-nw-border bg-nw-surface px-3">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-1">
            <h2 id="home-shift-title" className="m-0 text-sm font-semibold">{shift?'الوردية مفتوحة':'لا توجد وردية مفتوحة'}</h2>
            {shift&&<span className="text-sm">المتوقع بالدرج <MoneyText amount={shift.expectedCash} className="font-bold"/></span>}
            <UiButton onClick={onShift}>{shift?'الصندوق':'فتح الصندوق'}</UiButton>
          </div>
          {shift&&<details data-testid="home-shift-flows"><summary className="min-h-11 cursor-pointer py-3 text-xs text-nw-muted">تفصيل داخل / طالع</summary><div className="pb-3"><CashFlowSummary shift={shift}/></div></details>}
        </section>
        <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
          <button onClick={onOrders} className="flex min-h-11 min-w-0 items-center justify-between gap-1 rounded-xl bg-nw-surface px-3 text-right text-nw-primary"><span>{actionCount} طلبات تحتاج إجراء</span><ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true"/></button>
          <button onClick={onInventory} className="flex min-h-11 min-w-0 items-center justify-between gap-1 rounded-xl bg-nw-surface px-3 text-right text-nw-primary"><span>{stockIssues} تنبيه مخزون</span><ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true"/></button>
        </div>
        {data.chequeAlerts&&(data.chequeAlerts.due>0||data.chequeAlerts.overdue>0)&&<Card className="space-y-2" data-testid="home-cheque-alert">
          <SectionHeader title="مواعيد الشيكات" action={onCheques&&<UiButton onClick={onCheques}>فتح الشيكات</UiButton>} />
          <p className="m-0 text-sm">خلال يومين: <bdi>{data.chequeAlerts.due}</bdi> · متأخرة: <bdi>{data.chequeAlerts.overdue}</bdi></p>
          <p className="m-0 text-sm text-nw-muted">تأكد من كفاية رصيد الشيكات الصادرة: <MoneyText amount={data.chequeAlerts.outgoingDue/1000} currency /></p>
        </Card>}
        {salesHistory&&<RecentSalesCard state={salesHistory} onOpen={id=>onInvoice?.(id)} onViewAll={()=>onSalesHistory?.()}/>}

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
        <SupplierReplacementSummary ownerOnly />
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
          <details className="mt-4 text-sm"><summary className="min-h-11 cursor-pointer text-nw-muted">تفاصيل إضافية</summary><dl className="space-y-2 text-nw-muted"><div>صافي مبيعات الشهر بعد المرتجعات: {money(summary.monthNetSalesInMinorUnits, available)}</div><div>ذمم الموردين: {money(summary.supplierPayablesInMinorUnits, available)}</div>{summary.supplierAdvancesInMinorUnits !== undefined && <div>دفعات مقدّمة للموردين: {money(summary.supplierAdvancesInMinorUnits, available)}</div>}<div>عدد العملاء المتأخرين: غير متاح في قراءة الرئيسية</div>{data.access.canViewProfit && <div>ربح الشهر: {money(summary.monthProfitInMinorUnits, available)}</div>}</dl></details>
        </Card>
        {summary.activeProductsCount === 0 && summary.activeCustomersCount === 0 && data.latestOrders.length === 0 && <Card><SectionHeader title="ابدأ بإضافة أول صنف" hint="بعدها استلم الكميات، وستظهر المتابعة اليومية هنا تلقائياً." /><UiButton className="mt-3" onClick={onProducts}>إضافة صنف</UiButton></Card>}
      </div>
    </div>
  );
};
