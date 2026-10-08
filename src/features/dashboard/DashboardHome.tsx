import React, { useState } from 'react';
import { AlertTriangle, ChevronLeft, ClipboardList, PackagePlus, ReceiptText, RefreshCw, Truck, Boxes } from 'lucide-react';
import { Card, KpiCard, KpiGrid, MoneyText, SalesBarChart, SectionHeader, SegmentedControl, StatusBadge, TableShell, Td, Th, Tr, UiButton } from '../../components/ui';
import type { HomeDashboardData, HomeDashboardOrder } from '../../types/dashboard';
import type { Shift } from '../../types';
import type { UiTone } from '../../components/ui/uiFormat';

const statuses: Record<string, { label: string; tone: UiTone }> = {
  new: { label: 'جديد', tone: 'info' }, confirmed: { label: 'مؤكد', tone: 'warn' },
  preparing: { label: 'قيد التجهيز', tone: 'warn' }, ready: { label: 'جاهز للتوصيل', tone: 'ok' },
  out_for_delivery: { label: 'بالتوصيل', tone: 'info' },
};
const priority = ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];
const nextAction: Record<string, string> = {
  new: 'تأكيد الطلب', confirmed: 'بدء التجهيز', preparing: 'إكمال التجهيز',
  ready: 'بدء التوصيل', out_for_delivery: 'متابعة التوصيل',
};

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
}

const money = (minor: number | null | undefined, available: boolean) =>
  available && minor != null ? <MoneyText amount={minor / 1000} currency /> : 'غير متاح';

const OrderBadge: React.FC<{ order: HomeDashboardOrder }> = ({ order }) => {
  const status = statuses[order.status];
  return <StatusBadge tone={status?.tone ?? 'mute'}>{status?.label ?? order.status}</StatusBadge>;
};

/** Shared live/harness presentation. Fixtures never enter the live loader. */
export const DashboardHome: React.FC<DashboardHomeProps> = ({ data, currentUserName, currentShift, loading, error, realtimeConnected, onRefresh, onOrders, onAccounts, onInventory, onProducts, onShift, onSell, onReceive, onExpense }) => {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const { summary, financialFactsAvailable: available } = data;
  const days = [...data.sevenDaySales].sort((a, b) => a.date.localeCompare(b.date));
  const date = new Date(data.generatedAt);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const activeOrders = [...data.latestOrders].filter((order) => priority.includes(order.status))
    .sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status)).slice(0, 4);
  const count = (values: string[]) => data.orderStatuses.filter((item) => values.includes(item.status)).reduce((sum, item) => sum + item.count, 0);
  const stockIssues = summary.lowStockCount + summary.outOfStockCount + summary.configurationIssuesCount;
  const lanes = [
    { label: 'طلبات جديدة', count: summary.newOrdersCount, Icon: ClipboardList, onClick: onOrders },
    { label: 'قيد التجهيز', count: count(['confirmed', 'preparing', 'ready']), Icon: Boxes, onClick: onOrders },
    { label: 'بالتوصيل', count: count(['out_for_delivery']), Icon: Truck, onClick: onOrders },
    { label: 'تنبيهات المخزون', count: stockIssues, Icon: AlertTriangle, onClick: onInventory },
  ];
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
            <p className="mt-1 text-xs text-nw-side-muted lg:text-nw-muted">{date.toLocaleDateString('ar-JO', { timeZone: 'Asia/Amman', weekday: 'long', day: 'numeric', month: 'long' })} · مركز اليوم</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="hidden lg:block"><SegmentedControl touchSize label="فترة المبيعات" value={period} onChange={setPeriod} options={[{ value: 'day', label: 'اليوم' }, { value: 'week', label: 'الأسبوع' }, { value: 'month', label: 'الشهر' }]} /></div>
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
          <KpiCard label="المقبوض اليوم" value="غير متاح" note="كاش / CliQ" />
          <KpiCard label="ذمم العملاء" value={money(summary.customerReceivablesInMinorUnits, available)} className="[&>div:nth-child(2)]:text-xl" />
          <KpiCard label="تنبيهات المخزون" value={stockIssues} note="أصناف تحتاج متابعة" />
        </KpiGrid>
        <KpiGrid className="hidden lg:grid">
          <KpiCard label={periodLabel} value={money(periodSales, available)} note={`${summary.todayCompletedOrders} طلب مكتمل اليوم`} className="[&>div:nth-child(2)]:text-xl xl:[&>div:nth-child(2)]:text-2xl" />
          <KpiCard label="صافي الشهر" value={money(summary.monthNetSalesInMinorUnits, available)} note="بعد استحقاق المرتجعات" className="[&>div:nth-child(2)]:text-xl xl:[&>div:nth-child(2)]:text-2xl" />
          <KpiCard label="المقبوض اليوم" value="غير متاح" note="تفصيل كاش / CliQ غير متاح في قراءة الرئيسية" className="[&>div:nth-child(2)]:text-xl" />
          <KpiCard label="ذمم العملاء" value={money(summary.customerReceivablesInMinorUnits, available)} note={<button type="button" className="min-h-11 text-right text-nw-primary" onClick={onAccounts}>مراجعة العملاء والذمم</button>} className="[&>div:nth-child(2)]:text-xl xl:[&>div:nth-child(2)]:text-2xl" />
        </KpiGrid>
        </div>

        <div className="flex flex-wrap items-stretch gap-5">
          <Card aria-labelledby="home-orders-title" className="order-2 min-w-0 flex-[2_1_520px] lg:order-1">
            <SectionHeader id="home-orders-title" title="طلبات تحتاج إجراء" action={<UiButton onClick={onOrders}>كل الطلبات <ChevronLeft className="h-4 w-4" aria-hidden="true" /></UiButton>} />
            <div className="mt-3 hidden lg:block">
              <TableShell caption="طلبات تحتاج إجراء — الإجراء التالي" minWidth={520} head={<><Th>رقم الطلب</Th><Th>العميل</Th><Th>المصدر</Th><Th>الحالة</Th><Th>الإجمالي</Th></>}>
                {activeOrders.map((order) => <Tr key={order.id}>
                  <Td><button className="min-h-11 font-semibold text-nw-primary" onClick={onOrders} aria-label={`${nextAction[order.status]} ${order.orderNumber}`}><bdi>{order.orderNumber}</bdi></button></Td>
                  <Td className="max-w-40 break-words">{order.customerName}</Td><Td>{order.source === 'pos' ? 'الكاشير' : order.source === 'website' ? 'المتجر' : order.source === 'admin' ? 'الإدارة' : order.source}</Td>
                  <Td><OrderBadge order={order} /></Td><Td><MoneyText amount={order.totalInMinorUnits / 1000} /></Td>
                </Tr>)}
              </TableShell>
            </div>
            <div className="mt-3 space-y-2 lg:hidden">
              {lanes.map(({ label, count: amount, Icon, onClick }) => <button key={label} onClick={onClick} className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-nw-surface-2 px-3 py-2 text-right">
                <Icon className="h-5 w-5 shrink-0 text-nw-muted" aria-hidden="true" /><span className="min-w-0 flex-1 text-sm font-semibold">{label}</span><StatusBadge tone={amount ? 'info' : 'mute'}>{amount}</StatusBadge><ChevronLeft className="h-4 w-4 text-nw-muted" aria-hidden="true" />
              </button>)}
              {activeOrders.map((order) => <button key={order.id} onClick={onOrders} className="flex min-h-14 w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-nw-border p-3 text-right">
                <span className="min-w-0 flex-1 break-words text-sm"><bdi className="font-bold">{order.orderNumber}</bdi> · {order.customerName}<span className="mt-1 block text-xs text-nw-muted">الإجراء التالي: {nextAction[order.status]}</span></span><OrderBadge order={order} />
              </button>)}
            </div>
            {!activeOrders.length && <p className="py-8 text-center text-sm text-nw-muted">لا توجد طلبات معلّقة.</p>}
          </Card>

          <Card aria-labelledby="home-shift-title" className="order-1 min-w-0 flex-[1_1_280px] lg:order-2">
            <SectionHeader id="home-shift-title" title="الوردية الحالية" action={<StatusBadge tone={shift ? 'ok' : 'mute'}>{shift ? 'مفتوحة' : 'لا توجد وردية مفتوحة'}</StatusBadge>} />
            {shift ? <>
              <div className="mt-4 lg:hidden">
                <div className="flex items-center justify-between gap-3"><span className="text-sm text-nw-muted">النقد المتوقع بالصندوق</span><MoneyText amount={shift.expectedCash} className="text-2xl font-bold" /></div>
                <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-nw-border pt-3 text-center text-xs">
                  <div><dt className="text-nw-muted">مبيعات كاش</dt><dd className="m-0 mt-1 font-bold"><MoneyText amount={shift.totalCashSales} /></dd></div>
                  <div><dt className="text-nw-muted">الرصيد الافتتاحي</dt><dd className="m-0 mt-1 font-bold"><MoneyText amount={shift.openingCash} /></dd></div>
                  <div><dt className="text-nw-muted">بداية الوردية</dt><dd className="m-0 mt-1 font-bold">{new Date(shift.startTime).toLocaleTimeString('ar-JO', { timeZone: 'Asia/Amman', hour: '2-digit', minute: '2-digit' })}</dd></div>
                </dl>
              </div>
              <dl className="mt-4 hidden space-y-3 text-sm lg:block">
                {[
                  ['الرصيد الافتتاحي', shift.openingCash], ['مبيعات كاش', shift.totalCashSales],
                  ['سندات قبض كاش', shift.cashReceipts], ['مرتجعات مدفوعة كاش', -shift.cashRefunds],
                  ['مصروفات من الدرج', -shift.cashExpenses],
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
            <div className="mt-5">{netAvailable ? <SalesBarChart label="صافي المبيعات آخر 7 أيام" points={days.map((day) => ({ id: day.date, label: day.date === today ? 'اليوم' : new Date(`${day.date}T12:00:00+03:00`).toLocaleDateString('ar-JO', { weekday: 'long' }), amount: day.netSalesInMinorUnits! / 1000, current: day.date === today }))} /> : <p className="py-12 text-center text-nw-muted">غير متاح</p>}</div>
          </Card>
          <Card aria-labelledby="home-stock-title" className="min-w-0 flex-[1_1_280px]">
            <SectionHeader id="home-stock-title" title="تنبيهات المخزون" action={<StatusBadge tone={stockIssues ? 'warn' : 'ok'}>{stockIssues}</StatusBadge>} hint="الجاهزية محسوبة حسب طرد البيع" />
            <div className="mt-4 space-y-2">
              {data.stockAlerts.slice(0, 5).map((item) => <div key={item.id} className="rounded-xl bg-nw-surface-2 p-3">
                <div className="flex items-start justify-between gap-2"><p className="min-w-0 break-words text-sm font-semibold">{item.nameAr}</p><StatusBadge tone={item.severity === 'configuration' ? 'info' : item.severity === 'out_of_stock' ? 'bad' : 'warn'}>{item.severity === 'configuration' ? 'إعداد' : item.severity === 'out_of_stock' ? 'نفد' : 'منخفض'}</StatusBadge></div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-nw-muted">{item.severity === 'configuration' ? 'أكمل بيانات طرد البيع والسعر' : `${item.availableSalePackages} ${item.saleUnitName} متاح`}</p><UiButton onClick={() => item.severity === 'configuration' ? onProducts() : onReceive(item.id)}>{item.severity === 'configuration' ? 'ضبط' : 'استلام'}</UiButton></div>
              </div>)}
              {!stockIssues && <p className="py-6 text-sm text-nw-muted">المخزون جاهز؛ لا توجد تنبيهات.</p>}
            </div>
          </Card>
        </div>
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
