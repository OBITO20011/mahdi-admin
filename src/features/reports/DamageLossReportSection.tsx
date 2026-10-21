import {Card, DataTable, MoneyText, SectionHeader, Td, Th, Tr} from '../../components/ui';
import type {DamageLosses} from '../../types/reports';

const reasons: Record<string,string> = {
  shop_breakage: 'انكسر بالمحل', expired: 'انتهت الصلاحية', storage_damage: 'تلف تخزين',
  other: 'أخرى', customer_return_final: 'مرتجع زبون تالف نهائي',
  supplier_writeoff:'رفض المورد للاستبدال',customer_return_supplier_hold:'إعادة تصنيف مرتجع إلى معلّق',
  supplier_writeoff_reversal:'عكس رفض المورد',shop_damage_reversal:'عكس تلف المحل',customer_return_supplier_hold_reversal:'عكس تعليق المرتجع لدى المورد',
};

export function DamageLossReportSection({losses}: {losses?: DamageLosses}) {
  return <Card data-testid="report-damage-losses" className="print-section space-y-4">
    <SectionHeader title="خسائر التلف" hint="التلف المسجل خلال الفترة بتكلفته وقت الحركة" />
    {losses ? <>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div><dt className="text-sm text-nw-muted">{losses.contractVersion===208?'صافي خسائر التلف':'إجمالي خسائر التلف'}</dt><dd className="m-0 mt-1 text-xl font-bold text-nw-bad"><MoneyText amount={losses.total} currency /></dd></div>
        <div><dt className="text-sm text-nw-muted">منها محتسب أصلاً ضمن المرتجعات</dt><dd className="m-0 mt-1 text-xl font-bold"><MoneyText amount={losses.alreadyIncluded} currency /></dd></div>
        <div><dt className="text-sm text-nw-muted">{losses.contractVersion===208?'أثر إضافي على الربح':'خصم إضافي من الربح — تلف المحل'}</dt><dd className="m-0 mt-1 text-xl font-bold"><MoneyText amount={losses.additional} currency /></dd></div>
      </dl>
      {losses.contractVersion===208?<>
        <p className="text-sm text-nw-muted">الخسارة قبل العكس وإعادة التصنيف: <MoneyText amount={losses.gross??0} currency /> · الاسترداد وإعادة التصنيف: <MoneyText amount={losses.recovered??0} currency /></p>
        <p className="text-sm text-nw-muted">المعلّق أصل منفصل. يعاد تصنيف خسارة المرتجع المحتسبة أصلاً عند إرساله للمورد، ويثبت الرفض مرة واحدة. العكس اللاحق يظهر في فترته وقد يجعل الصافي سالباً.</p>
      </>:<p className="text-sm text-nw-muted">تلف المرتجع المحتسب أصلًا يظهر للتوضيح؛ يُخصم تلف المحل الإضافي من صافي الربح مرة واحدة.</p>}
      {losses.reasons.length ? <DataTable caption="خسائر التلف حسب السبب">
        <thead><Tr><Th>السبب</Th><Th>الحركات</Th><Th>الكمية</Th><Th>الخسارة</Th><Th>منها محتسب أصلاً</Th></Tr></thead>
        <tbody>{losses.reasons.map((r) => <Tr key={r.code}><Td>{reasons[r.code] ?? r.code}</Td><Td>{r.count}</Td><Td>{r.quantity}</Td><Td><MoneyText amount={r.amount} /></Td><Td><MoneyText amount={r.alreadyIncluded} /></Td></Tr>)}</tbody>
      </DataTable> : <p className="text-sm text-nw-muted">لا توجد خسائر تلف مسجلة خلال الفترة.</p>}
    </> : <p role="status" className="text-sm text-nw-muted">خسائر التلف غير متاحة في قراءة التقرير.</p>}
  </Card>;
}
