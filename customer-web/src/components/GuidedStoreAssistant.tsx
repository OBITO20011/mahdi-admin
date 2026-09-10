import {
  ArrowLeft,
  Banknote,
  CircleHelp,
  ExternalLink,
  MapPinned,
  MessageCircle,
  PackageSearch,
  ReceiptText,
  Sparkles,
  Tags,
  Truck,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PublicStorefrontSettings } from '../types/storefront';
import { formatJod } from '../utils/money';

type AssistantTopic = 'delivery' | 'payment' | 'faq' | null;

interface GuidedStoreAssistantProps {
  isOpen: boolean;
  showFloatingButton: boolean;
  settings: PublicStorefrontSettings | null;
  whatsappUrl: string;
  onOpen: () => void;
  onClose: () => void;
  onBrowseProducts: () => void;
  onOpenOffers: () => void;
  onTrackOrder: () => void;
  hasCartItems: boolean;
}

const FAQ_ITEMS = [
  {
    question: 'كيف أطلب؟',
    answer: 'تصفح المنتجات، أضف الطرود المناسبة إلى السلة، ثم راجع البيانات والدفع قبل إرسال الطلب.',
  },
  {
    question: 'هل الأسعار والكميات تتحدث؟',
    answer: 'نعم، تُراجع الأسعار والكميات المتاحة مع المخزون عند إرسال الطلب.',
  },
  {
    question: 'كيف أتابع طلبي؟',
    answer: 'استخدم رقم الطلب ورقم الهاتف في صفحة متابعة الطلب لمعرفة الحالة الحالية.',
  },
] as const;

export function GuidedStoreAssistant({
  isOpen,
  showFloatingButton,
  settings,
  whatsappUrl,
  onOpen,
  onClose,
  onBrowseProducts,
  onOpenOffers,
  onTrackOrder,
  hasCartItems,
}: GuidedStoreAssistantProps) {
  const [topic, setTopic] = useState<AssistantTopic>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setTopic(null);
      return;
    }

    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
    };
  }, [isOpen, onClose]);

  const closeThen = (action: () => void) => {
    onClose();
    action();
  };

  const actions = [
    { id: 'products', label: 'تصفح المنتجات', icon: PackageSearch, action: () => closeThen(onBrowseProducts) },
    { id: 'offers', label: 'العروض الحالية', icon: Tags, action: () => closeThen(onOpenOffers) },
    { id: 'tracking', label: 'تتبع طلبي', icon: ReceiptText, action: () => closeThen(onTrackOrder) },
    { id: 'delivery', label: 'مناطق ورسوم التوصيل', icon: Truck, action: () => setTopic('delivery') },
    { id: 'payment', label: 'طرق الدفع', icon: Banknote, action: () => setTopic('payment') },
    { id: 'faq', label: 'الأسئلة الشائعة', icon: CircleHelp, action: () => setTopic('faq') },
  ] as const;

  return (
    <>
      {showFloatingButton && (
        <button
          type="button"
          ref={triggerRef}
          onClick={onOpen}
          aria-label="فتح مساعد المتجر"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          data-testid="guided-store-assistant-trigger"
          className={`fixed right-4 z-30 grid h-12 w-12 place-items-center rounded-2xl bg-[#0b1b3f] text-amber-200 shadow-xl shadow-slate-950/25 transition hover:-translate-y-0.5 hover:bg-[#132a5d] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-200 md:bottom-6 md:right-6 md:h-14 md:w-14 ${
            hasCartItems ? 'bottom-[9.75rem]' : 'bottom-[5.8rem]'
          }`}
        >
          <MessageCircle className="h-5 w-5 md:h-6 md:w-6" aria-hidden="true" />
          <span className="sr-only">مساعد المتجر</span>
        </button>
      )}

      <div
        className={`fixed inset-0 z-[80] transition ${
          isOpen ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <button
          type="button"
          aria-label="إغلاق مساعد المتجر"
          onClick={onClose}
          tabIndex={isOpen ? 0 : -1}
          className={`absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] transition-opacity ${
            isOpen ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <section
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="guided-store-assistant-title"
          data-testid="guided-store-assistant-panel"
          className={`absolute inset-x-0 bottom-0 max-h-[min(44rem,calc(100dvh-1rem))] overflow-y-auto rounded-t-[2rem] border border-white/80 bg-[#fbf7f0] shadow-2xl transition-transform duration-200 motion-reduce:transition-none sm:bottom-6 sm:right-6 sm:left-auto sm:w-[25rem] sm:rounded-[2rem] ${
            isOpen ? 'translate-y-0' : 'translate-y-full sm:translate-y-[calc(100%+1.5rem)]'
          }`}
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-amber-100 bg-[#fbf7f0]/95 px-5 pb-4 pt-5 backdrop-blur sm:rounded-t-[2rem]">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#0b1b3f] text-amber-200 shadow-lg shadow-slate-950/15">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[10px] font-black text-amber-700">مساعد النواصرة</p>
                <h2 id="guided-store-assistant-title" className="mt-1 text-base font-black text-slate-950">
                  أهلًا بك في محلات النواصرة التجارية 👋
                </h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">كيف نقدر نساعدك؟</p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => {
                onClose();
                window.setTimeout(() => triggerRef.current?.focus(), 0);
              }}
              aria-label="إغلاق"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {topic ? (
              <AssistantTopicContent topic={topic} settings={settings} onBack={() => setTopic(null)} />
            ) : (
              <div className="grid gap-2" aria-label="خيارات مساعد المتجر">
                {actions.map(({ id, label, icon: Icon, action }) => (
                  <button
                    type="button"
                    key={id}
                    data-testid={`guided-store-assistant-${id}`}
                    onClick={action}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-right text-xs font-black text-slate-800 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                  >
                    <span className="flex items-center gap-3"><Icon className="h-4 w-4 text-blue-700" aria-hidden="true" />{label}</span>
                    <ArrowLeft className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="guided-store-assistant-whatsapp"
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-3 text-xs font-black text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />تواصل عبر WhatsApp<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </section>
      </div>
    </>
  );
}

function AssistantTopicContent({
  topic,
  settings,
  onBack,
}: {
  topic: Exclude<AssistantTopic, null>;
  settings: PublicStorefrontSettings | null;
  onBack: () => void;
}) {
  const cliqAlias = settings?.cliqAlias.trim();

  return (
    <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-4">
      <button type="button" onClick={onBack} className="mb-3 inline-flex min-h-11 items-center gap-2 px-1 text-xs font-black text-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">
        <ArrowLeft className="h-4 w-4" />كل الخيارات
      </button>

      {topic === 'delivery' && (
        <div className="space-y-3 text-xs leading-6 text-slate-700">
          <div className="flex items-center gap-2 text-slate-950"><MapPinned className="h-5 w-5 text-blue-700" /><h3 className="font-black">مناطق ورسوم التوصيل</h3></div>
          {settings ? (
            <>
              <p>{settings.deliveryAreasText}</p>
              <p className="rounded-2xl bg-white p-3 font-bold text-slate-600">وقت التجهيز والتوصيل: {settings.deliveryEtaText}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <p className="rounded-2xl bg-white p-3 font-black text-slate-800">داخل الرمثا<br /><span className="text-blue-800">{formatJod(settings.insideRamthaDeliveryFeeInMinorUnits)}</span></p>
                <p className="rounded-2xl bg-white p-3 font-black text-slate-800">خارج الرمثا<br /><span className="text-blue-800">{formatJod(settings.outsideRamthaDeliveryFeeInMinorUnits)}</span></p>
              </div>
              <p className="text-[10px] font-bold text-slate-500">تُؤكد المنطقة مع الإدارة قبل التجهيز.</p>
            </>
          ) : <p>تواصل معنا لمعرفة تفاصيل التوصيل.</p>}
        </div>
      )}

      {topic === 'payment' && (
        <div className="space-y-3 text-xs leading-6 text-slate-700">
          <div className="flex items-center gap-2 text-slate-950"><Banknote className="h-5 w-5 text-blue-700" /><h3 className="font-black">طرق الدفع</h3></div>
          <p className="rounded-2xl bg-white p-3"><strong className="text-slate-950">كاش عند الاستلام</strong><br />يُراجع الطلب مع الإدارة قبل التجهيز.</p>
          <p className="rounded-2xl bg-white p-3"><strong className="text-slate-950">CliQ</strong><br />{cliqAlias ? <>حوّل إلى <b dir="ltr" className="text-blue-800">{cliqAlias}</b>، ويؤكد الفريق استلام التحويل قبل التجهيز.</> : 'يؤكد فريق المتجر بيانات التحويل واستلامه قبل التجهيز.'}</p>
        </div>
      )}

      {topic === 'faq' && (
        <div className="space-y-3 text-xs leading-6 text-slate-700">
          <div className="flex items-center gap-2 text-slate-950"><CircleHelp className="h-5 w-5 text-blue-700" /><h3 className="font-black">أسئلة شائعة</h3></div>
          {FAQ_ITEMS.map((item) => <article key={item.question} className="rounded-2xl bg-white p-3"><h4 className="font-black text-slate-950">{item.question}</h4><p className="mt-1.5 font-semibold text-slate-600">{item.answer}</p></article>)}
        </div>
      )}
    </div>
  );
}
