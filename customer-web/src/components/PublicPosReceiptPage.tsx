import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  PackageCheck,
  Printer,
  ReceiptText,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchPublicPosReceipt } from '../services/receipts.service';
import type { PublicPosReceipt } from '../types/receipt';

const money = (minorUnits: number) =>
  `${(minorUnits / 1000).toLocaleString('ar-JO', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} د.أ`;

const paymentLabel = (method: string) =>
  ({
    cash: 'كاش',
    cliq: 'CliQ',
    card: 'بطاقة',
    bank_transfer: 'تحويل بنكي',
    debt: 'آجل على الحساب',
    mixed: 'دفع مختلط',
  })[method] || method || 'غير محدد';

export function PublicPosReceiptPage({ token }: { token: string }) {
  const [receipt, setReceipt] = useState<PublicPosReceipt | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError('');
    fetchPublicPosReceipt(token)
      .then((result) => {
        if (!active) return;
        setReceipt(result);
        document.title = `إيصال ${result.orderNumber} | محلات النواصرة`;
      })
      .catch((loadError) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'تعذر تحميل الإيصال.'
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const shareReceipt = async () => {
    if (!receipt) return;
    const text = `إيصال ${receipt.orderNumber} من ${receipt.branch.name}\nالإجمالي: ${money(receipt.totalInMinorUnits)}`;
    if (navigator.share) {
      await navigator.share({
        title: `إيصال ${receipt.orderNumber}`,
        text,
        url: window.location.href,
      });
      return;
    }
    await navigator.clipboard.writeText(window.location.href);
  };

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-6 text-slate-950" dir="rtl">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body { background: #fff !important; }
          .receipt-actions { display: none !important; }
          .public-pos-receipt { box-shadow: none !important; border: 0 !important; }
        }
      `}</style>

      <main className="public-pos-receipt mx-auto max-w-2xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl">
        <header className="bg-gradient-to-br from-blue-950 via-blue-900 to-blue-700 px-5 py-6 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-black text-blue-200">
                <ReceiptText className="h-4 w-4" />
                إيصال إلكتروني موثّق
              </div>
              <h1 className="text-2xl font-black">{receipt?.branch.name || 'محلات النواصرة'}</h1>
              <p className="mt-1 text-xs text-blue-100">تجارة الجملة والمواد الغذائية</p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 p-3">
              <ShieldCheck className="h-7 w-7 text-emerald-300" />
            </div>
          </div>
        </header>

        {isLoading && (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            <p className="text-sm font-bold">جاري تحميل الإيصال من Supabase...</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500" />
            <h2 className="text-lg font-black">تعذر فتح الإيصال</h2>
            <p className="text-sm leading-7 text-slate-500">{error}</p>
            <a href="/products" className="mt-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white">العودة إلى المتجر</a>
          </div>
        )}

        {!isLoading && receipt && (
          <div className="space-y-5 p-5 sm:p-7">
            <section className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs">
              <div><span className="block text-slate-500">رقم الإيصال</span><b className="mt-1 block font-mono text-blue-800">{receipt.orderNumber}</b></div>
              <div><span className="block text-slate-500">التاريخ</span><b className="mt-1 block">{new Date(receipt.createdAt).toLocaleString('ar-JO')}</b></div>
              <div><span className="block text-slate-500">طريقة الدفع</span><b className="mt-1 block">{paymentLabel(receipt.paymentMethod)}</b></div>
              <div><span className="block text-slate-500">الحالة</span><b className="mt-1 block text-emerald-700">{receipt.status === 'returned' ? 'مرتجع' : 'مكتمل'}</b></div>
            </section>

            {receipt.status === 'returned' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">هذه الفاتورة مسجلة كمرتجعة في نظام الإدارة.</div>
            )}

            <section>
              <h2 className="mb-3 flex items-center gap-2 text-base font-black"><PackageCheck className="h-5 w-5 text-blue-700" />أصناف الجملة</h2>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                {receipt.items.map((item, index) => (
                  <article key={`${item.sku}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 border-t border-slate-200 p-4 first:border-0">
                    <div className="min-w-0">
                      <h3 className="font-black">{item.productName}</h3>
                      <p className="mt-1 text-[11px] text-slate-500">{item.packageQuantity} {item.packageName} × {money(item.packagePriceInMinorUnits)} · محتوى الطرد {item.unitsPerPackage}</p>
                      {item.sku && <small className="font-mono text-[10px] text-slate-400">{item.sku}</small>}
                    </div>
                    <b className="text-sm text-blue-900">{money(item.lineTotalInMinorUnits)}</b>
                  </article>
                ))}
              </div>
            </section>

            <section className="space-y-2 rounded-2xl bg-slate-950 p-5 text-sm text-white">
              <div className="flex justify-between text-slate-300"><span>المجموع الفرعي</span><b>{money(receipt.subtotalInMinorUnits)}</b></div>
              {receipt.discountInMinorUnits > 0 && <div className="flex justify-between text-emerald-300"><span>الخصم</span><b>-{money(receipt.discountInMinorUnits)}</b></div>}
              <div className="flex justify-between border-t border-slate-700 pt-3 text-lg font-black"><span>الإجمالي</span><b className="text-amber-300">{money(receipt.totalInMinorUnits)}</b></div>
            </section>

            <footer className="text-center text-xs leading-6 text-slate-500">
              {receipt.branch.address && <p>{receipt.branch.address}</p>}
              {receipt.branch.phone && <p dir="ltr">{receipt.branch.phone}</p>}
              <p className="mt-2 flex items-center justify-center gap-1 font-bold text-emerald-700"><ShieldCheck className="h-4 w-4" />تم تحميل الإيصال مباشرة من نظام نواصرة</p>
            </footer>

            <div className="receipt-actions grid grid-cols-3 gap-2">
              <button type="button" onClick={() => window.print()} className="flex items-center justify-center gap-1 rounded-xl bg-blue-700 px-2 py-3 text-xs font-black text-white"><Printer className="h-4 w-4" />طباعة</button>
              <button type="button" onClick={() => void shareReceipt()} className="flex items-center justify-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-2 py-3 text-xs font-black text-blue-800"><Share2 className="h-4 w-4" />مشاركة</button>
              <a href="/products" className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-2 py-3 text-xs font-black text-slate-700"><ArrowRight className="h-4 w-4" />المتجر</a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
