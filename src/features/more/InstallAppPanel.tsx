import {UiButton} from '../../components/ui';
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
      <UiButton variant="plain"
        type="button"
        onClick={() => void handleInstall()}
        className="!h-auto min-h-11 w-full flex items-center justify-between overflow-hidden rounded-2xl border border-nw-info bg-nw-surface-2 p-4 text-right shadow-lg transition hover:border-nw-info"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-nw-primary text-nw-on-primary shadow-lg ">
            {isInstalled ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Download className="h-5 w-5" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-black text-nw-text">
              {isInstalled ? 'تطبيق الإدارة مثبت' : 'تثبيت التطبيق على iPhone'}
            </h3>
            <p className="mt-1 text-xs leading-5 text-nw-muted">
              {isInstalled
                ? 'يعمل الآن كتطبيق مستقل من الشاشة الرئيسية.'
                : 'دخول أسرع وشاشة كاملة دون شريط المتصفح.'}
            </p>
          </div>
        </div>
        {!isInstalled && <ChevronLeft className="h-4 w-4 text-nw-info" />}
      </UiButton>

      <Modal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        title="تثبيت تطبيق إدارة النواصرة"
        subtitle="يُثبت مباشرة من Safari ويعمل من الشاشة الرئيسية"
        maxHeight="max-h-[82vh]"
      >
        <div className="space-y-4" dir="rtl">
          <div className="rounded-2xl border border-nw-info bg-nw-info-bg p-4 text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-[22px] bg-nw-primary text-nw-on-primary shadow-xl">
              <Download className="h-7 w-7" />
            </div>
            <h4 className="text-sm font-black text-nw-text">ثلاث خطوات فقط</h4>
            <p className="mt-1 text-sm leading-5 text-nw-muted">
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

          <div className="flex items-start gap-2 rounded-xl border border-nw-ok bg-nw-ok-bg p-3 text-xs leading-5 text-nw-ok">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-nw-ok" />
            <span>
              التثبيت لا ينسخ بيانات المخزون أو الحسابات إلى الجهاز؛ جميع العمليات
              الحساسة تبقى مباشرة ومحميّة عبر Supabase.
            </span>
          </div>

          <UiButton variant="plain"
            type="button"
            onClick={() => setIsHelpOpen(false)}
            className="w-full rounded-xl bg-nw-primary px-4 py-3 text-xs font-black text-nw-on-primary transition hover:brightness-105"
          >
            فهمت، سأثبت التطبيق
          </UiButton>
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
  <li className="flex items-start gap-3 rounded-xl border border-nw-border bg-nw-surface-2 p-3">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-nw-surface text-nw-info">
      {icon}
    </span>
    <div className="flex-1">
      <h5 className="text-xs leading-6 font-black text-nw-text">
        <span className="ml-1 text-nw-info">{number}.</span>
        {title}
      </h5>
      <p className="mt-1 text-xs leading-5 text-nw-muted">{description}</p>
    </div>
  </li>
);
