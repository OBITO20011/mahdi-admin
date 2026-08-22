import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ShoppingBag } from 'lucide-react';

interface StoreErrorBoundaryProps {
  children: ReactNode;
}

interface StoreErrorBoundaryState {
  hasError: boolean;
}

export class StoreErrorBoundary extends React.Component<
  StoreErrorBoundaryProps,
  StoreErrorBoundaryState
> {
  state: StoreErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): StoreErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[StoreErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main
        dir="rtl"
        className="grid min-h-screen place-items-center bg-[#f7f9fc] p-5 text-slate-900"
      >
        <section className="w-full max-w-lg rounded-[2rem] border border-slate-200 bg-white p-7 text-center shadow-2xl shadow-slate-900/10 sm:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-rose-50 text-rose-600">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <h1 className="mt-5 text-xl font-black">تعذر فتح المتجر الآن</h1>
          <p className="mt-3 text-xs font-bold leading-6 text-slate-500">
            لم يتم فقدان محتوى سلتك. أعد تحميل الصفحة، وإذا استمرت المشكلة
            تواصل مع محلات النواصرة.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-800"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة تحميل المتجر
          </button>
          <div className="mt-5 flex items-center justify-center gap-2 text-[10px] font-bold text-slate-400">
            <ShoppingBag className="h-3.5 w-3.5" />
            سلة الجملة محفوظة على هذا الجهاز
          </div>
        </section>
      </main>
    );
  }
}
