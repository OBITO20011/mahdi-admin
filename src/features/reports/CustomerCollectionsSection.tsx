import {Card,MoneyText,SectionHeader} from '../../components/ui';
import {customerCollectionRows,type CustomerCollectionsInMinorUnits} from '../../utils/customerCollections';

export function CustomerCollectionsSection({collections}:{collections?:CustomerCollectionsInMinorUnits}) {
  return <Card data-testid="report-customer-collections" className="print-section space-y-4">
    <SectionHeader title="المقبوض من العملاء" hint="تحصيل الفواتير ودين البداية وقيود الشيكات، بعد عكس التحصيل وقبل رد المبالغ" />
    {collections ? <>
      <p className="text-2xl font-bold"><MoneyText amount={collections.totalInMinorUnits/1000} currency /></p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{customerCollectionRows(collections).map(row=><div key={row.label}><dt className="text-sm text-nw-muted">{row.label}</dt><dd className="m-0 mt-1 font-bold"><MoneyText amount={row.amount/1000} currency /></dd></div>)}</dl>
      <p className="text-sm text-nw-muted">الكاش داخل الدرج؛ CliQ والتحويل والشيك خارجه. صرف الشيك المستلم ليس قبضًا جديدًا.</p>
    </> : <p role="status" className="text-sm text-nw-muted">تفصيل المقبوض بكل طرق الدفع غير متاح في قراءة التقرير.</p>}
  </Card>;
}
