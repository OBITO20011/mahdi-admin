import React, {useEffect, useState} from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  Download,
  Share2,
  ShieldCheck,
  SquarePlus,
} from 'lucide-react';
import {Modal} from '../../components/common/Modal';
import {
  BeforeInstallPromptEvent,
  isRunningStandalone,
} from '../../pwa/pwa';

export const InstallAppPanel: React.FC = () => {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isInstalled, setIsInstalled] = useState(isRunningStandalone);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
      setIsHelpOpen(false);
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (isInstalled) return;

    if (!installPrompt) {
      setIsHelpOpen(true);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleInstall()}
        className="w-full flex items-center justify-between overflow-hidden rounded-2xl border border-blue-500/30 bg-gradient-to-l from-blue-950/90 via-slate-900 to-slate-950 p-4 text-right shadow-lg transition hover:border-blue-400/60"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-950/50">
            {isInstalled ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Download className="h-5 w-5" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-100">
              {isInstalled ? 'تطبيق الإدارة مثبت' : 'تثبيت التطبيق على iPhone'}
            </h3>
            <p className="mt-1 text-[10px] leading-5 text-slate-400">
              {isInstalled
                ? 'يعمل الآن كتطبيق مستقل من الشاشة الرئيسية.'
                : 'دخول أسرع وشاشة كاملة دون شريط المتصفح.'}
            </p>
          </div>
        </div>
        {!isInstalled && <ChevronLeft className="h-4 w-4 text-blue-400" />}
      </button>

      <Modal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        title="تثبيت تطبيق إدارة النواصرة"
        subtitle="يُثبت مباشرة من Safari ويعمل من الشاشة الرئيسية"
        maxHeight="max-h-[82vh]"
      >
        <div className="space-y-4" dir="rtl">
          <div className="rounded-2xl border border-blue-500/25 bg-blue-950/40 p-4 text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-blue-600 to-indigo-950 text-white shadow-xl">
              <Download className="h-7 w-7" />
            </div>
            <h4 className="text-sm font-black text-slate-100">ثلاث خطوات فقط</h4>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              افتح رابط لوحة الإدارة داخل متصفح Safari على جهاز iPhone.
            </p>
          </div>

          <ol className="space-y-3">
            <InstallStep
              number="1"
              icon={<Share2 className="h-4 w-4" />}
              title="اضغط زر المشاركة"
              description="ستجده في شريط Safari أسفل الشاشة أو أعلاها."
            />
            <InstallStep
              number="2"
              icon={<SquarePlus className="h-4 w-4" />}
              title="اختر إضافة إلى الشاشة الرئيسية"
              description="قد تحتاج للتمرير داخل قائمة المشاركة حتى يظهر الخيار."
            />
            <InstallStep
              number="3"
              icon={<CheckCircle2 className="h-4 w-4" />}
              title="اضغط إضافة"
              description="ستظهر أيقونة إدارة النواصرة بين تطبيقات الجهاز."
            />
          </ol>

          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-950/30 p-3 text-[10px] leading-5 text-emerald-200">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              التثبيت لا ينسخ بيانات المخزون أو الحسابات إلى الجهاز؛ جميع العمليات
              الحساسة تبقى مباشرة ومحميّة عبر Supabase.
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsHelpOpen(false)}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 text-xs font-black text-white transition hover:bg-blue-500"
          >
            فهمت، سأثبت التطبيق
          </button>
        </div>
      </Modal>
    </>
  );
};

interface InstallStepProps {
  number: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}

const InstallStep: React.FC<InstallStepProps> = ({
  number,
  icon,
  title,
  description,
}) => (
  <li className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-blue-400">
      {icon}
    </span>
    <div className="flex-1">
      <h5 className="text-xs font-black text-slate-100">
        <span className="ml-1 text-blue-400">{number}.</span>
        {title}
      </h5>
      <p className="mt-1 text-[10px] leading-5 text-slate-400">{description}</p>
    </div>
  </li>
);
