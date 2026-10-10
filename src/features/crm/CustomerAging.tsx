import {AgingBar, Card, KpiCard, KpiGrid, MoneyText, SectionHeader} from '../../components/ui';
import {agingSegments, useCustomerAging} from '../../hooks/useCustomerAccounts';

export function CustomerAgingSummary({revision}: {revision: unknown}) {
  const data = useCustomerAging(null, revision);
  return <div className="space-y-4" data-testid="customer-aging-summary">
    <KpiGrid phonePairs>
      <KpiCard label="إجمالي الذمم" value={data ? <MoneyText amount={data.total_in_minor_units / 1000} currency /> : 'غير متاح'} />
      <KpiCard label="متأخرون أكثر من 30 يوماً" value={data?.overdue_customer_count ?? 'غير متاح'} note="لا يشمل عمر غير متاح" valueTone="bad" />
      <KpiCard label="تجاوزوا حد الدين" value={data?.over_limit_customer_count ?? 'غير متاح'} valueTone="warn" />
      <KpiCard label="تحصيل هذا الشهر" value="غير متاح" note="لا يرجعه قارئ العملاء الحالي" />
    </KpiGrid>
    <Card className="space-y-4"><SectionHeader title="عمر الديون" hint="توزيع للعرض: أقدم دين أولاً؛ العمر غير المتاح منفصل ولا يُعدّ متأخراً." />
      {data ? <AgingBar segments={agingSegments(data)} /> : <p className="m-0 text-sm text-nw-muted">عمر الديون غير متاح</p>}
    </Card>
  </div>;
}

export function CustomerAgingDetail({customerId, revision}: {customerId: string; revision: unknown}) {
  const data = useCustomerAging(customerId, revision);
  return <Card className="space-y-3" data-testid="customer-aging-detail">
    <SectionHeader title="عمر الدين" />
    {data ? <AgingBar segments={agingSegments(data)} /> : <p className="m-0 text-sm text-nw-muted">عمر الدين غير متاح</p>}
  </Card>;
}
