import { ExternalLink, ShieldCheck, X } from 'lucide-react';
import { buildWhatsAppUrl } from '../utils/checkout';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeName: string;
  whatsappNumber: string;
}

const sections = [
  {
    title: 'البيانات التي نحتاجها',
    body: 'عند إرسال طلب نجمع الاسم ورقم الهاتف وعنوان التوصيل والأصناف وطريقة الدفع. تفاصيل العنوان والموقع والملاحظات اختيارية عندما تظهر كذلك في النموذج. لا يجمع المتجر بيانات بطاقات دفع.',
  },
  {
    title: 'لماذا نستخدمها',
    body: 'نستخدم البيانات لتسجيل الطلب، التحقق منه، تجهيز البضاعة، التواصل بشأن التوصيل، خدمة العميل، ومنع الطلبات المكررة أو المسيئة، ولحفظ السجلات التشغيلية والمحاسبية اللازمة.',
  },
  {
    title: 'الحفظ على جهازك',
    body: 'السلة والمفضلة تحفظ محليًا لتسهيل التسوق. خيار «حفظ بياناتي» اختياري ويحفظ بيانات التواصل والعنوان على هذا الجهاز لمدة 30 يومًا، ويمكنك مسحها من Checkout في أي وقت. لا تستخدمه على جهاز مشترك.',
  },
  {
    title: 'الخدمات التقنية',
    body: 'يعمل المتجر باستخدام Supabase لحفظ الطلبات، وCloudflare للاستضافة والتحقق الأمني، وSentry لمراقبة أخطاء تقنية منقحة. تمر تنبيهات تشغيلية مختصرة عبر n8n وTelegram، ولا تتضمن رقم هاتف العميل أو عنوانه أو موقعه. إذا اخترت التواصل عبر WhatsApp فستنتقل الرسالة التي ترسلها إلى WhatsApp وفق شروطه.',
  },
  {
    title: 'الحماية والاحتفاظ',
    body: 'نستخدم اتصالًا مشفرًا وصلاحيات موظفين ومصادقة إضافية للعمليات الحساسة، ونحتفظ بنسخ احتياطية مشفرة. تبقى سجلات الطلبات والمحاسبة والتدقيق حسب الحاجة التشغيلية والالتزامات المعتمدة؛ لم تعتمد بعد مدة حذف آلي موحدة لبيانات الأعمال.',
  },
  {
    title: 'طلباتك المتعلقة ببياناتك',
    body: 'يمكنك طلب معرفة بيانات طلبك أو تصحيحها، وطلب تقييدها أو حذفها عندما يكون ذلك مسموحًا ولا يتعارض مع سجل مالي أو تدقيق مطلوب. سنحتاج للتحقق من هويتك قبل تنفيذ أي طلب متعلق بالبيانات.',
  },
] as const;

export function PrivacyPolicyModal({
  isOpen,
  onClose,
  storeName,
  whatsappNumber,
}: PrivacyPolicyModalProps) {
  if (!isOpen) return null;

  const contactUrl = buildWhatsAppUrl(
    whatsappNumber,
    `مرحبًا ${storeName}، لدي طلب متعلق بخصوصية بياناتي.`,
  );

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-policy-title"
    >
      <div className="max-h-[94dvh] w-full overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:max-w-2xl sm:rounded-[2rem]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 bg-blue-950 px-5 py-5 text-white sm:px-7">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 id="privacy-policy-title" className="text-lg font-black">
                سياسة الخصوصية
              </h2>
              <p className="mt-1 text-[11px] font-bold text-blue-200">
                {storeName} — آخر تحديث 8 أيلول 2026
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق سياسة الخصوصية"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[calc(94dvh-8rem)] overflow-y-auto px-5 py-5 sm:px-7">
          <p className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-xs font-bold leading-6 text-blue-950">
            توضح هذه الصفحة ما يفعله المتجر تقنيًا ببياناتك. لا تمثل ادعاءً
            بالتوافق القانوني الكامل، وقد تتطلب بعض الطلبات مراجعة تشغيلية أو
            قانونية قبل تنفيذها.
          </p>

          <div className="mt-5 space-y-4">
            {sections.map((section) => (
              <section key={section.title} className="rounded-2xl border border-slate-200 p-4">
                <h3 className="text-sm font-black text-slate-950">{section.title}</h3>
                <p className="mt-2 text-xs font-semibold leading-6 text-slate-600">
                  {section.body}
                </p>
              </section>
            ))}
          </div>

          <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-emerald-950">
            <h3 className="text-sm font-black">التواصل بشأن الخصوصية</h3>
            <p className="mt-1 text-xs font-semibold leading-6">
              استخدم رقم WhatsApp المعلن للمتجر. لا ترسل معلومات حساسة إضافية
              قبل أن يطلبها منك موظف مخول للتحقق من الطلب.
            </p>
            <a
              href={contactUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white"
            >
              تواصل عبر WhatsApp
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
