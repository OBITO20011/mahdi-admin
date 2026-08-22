import { Check, ClipboardCheck, ShoppingBag, Truck, UserRound } from 'lucide-react';

interface CheckoutProgressProps {
  currentStep: 1 | 2 | 3 | 4;
  compact?: boolean;
}

const steps = [
  { title: 'سلة الشراء', subtitle: 'اختيار الأصناف', icon: ShoppingBag },
  { title: 'البيانات والدفع', subtitle: 'التوصيل والدفع', icon: UserRound },
  { title: 'مراجعة وإرسال', subtitle: 'تأكيد الطلب', icon: ClipboardCheck },
  { title: 'استلام الطلب', subtitle: 'وصل إلى الإدارة', icon: Truck },
] as const;

export function CheckoutProgress({
  currentStep,
  compact = false,
}: CheckoutProgressProps) {
  return (
    <div className={compact ? 'px-4 py-3' : 'px-5 py-4 sm:px-7'}>
      <div className="relative">
        <div className="absolute left-[7%] right-[7%] top-5 h-1 rounded-full bg-slate-100" />
        <div
          className="absolute right-[7%] top-5 h-1 rounded-full bg-gradient-to-l from-blue-700 to-emerald-500 transition-all duration-500"
          style={{ width: `${((currentStep - 1) / 3) * 86}%` }}
        />

        <div className="relative grid grid-cols-4 gap-1.5 sm:gap-3">
          {steps.map((step, index) => {
            const stepNumber = (index + 1) as 1 | 2 | 3 | 4;
            const isComplete = stepNumber < currentStep;
            const isCurrent = stepNumber === currentStep;
            const Icon = step.icon;

            return (
              <div key={step.title} className="min-w-0 text-center">
                <div
                  className={`mx-auto grid h-10 w-10 place-items-center rounded-2xl border-2 transition sm:h-11 sm:w-11 ${
                    isComplete
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : isCurrent
                        ? 'border-blue-700 bg-blue-700 text-white shadow-lg shadow-blue-900/20'
                        : 'border-slate-200 bg-white text-slate-400'
                  }`}
                >
                  {isComplete ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>
                <p
                  className={`mt-2 truncate text-[9px] font-black sm:text-[11px] ${
                    isCurrent
                      ? 'text-blue-800'
                      : isComplete
                        ? 'text-emerald-700'
                        : 'text-slate-400'
                  }`}
                >
                  {step.title}
                </p>
                {!compact && (
                  <p className="mt-0.5 hidden truncate text-[9px] font-bold text-slate-400 sm:block">
                    {isComplete ? 'مكتملة' : isCurrent ? 'المرحلة الحالية' : step.subtitle}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
