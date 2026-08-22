import { ArrowUp, MessageCircle } from 'lucide-react';

interface FloatingContactActionsProps {
  whatsappUrl: string;
}

export function FloatingContactActions({
  whatsappUrl,
}: FloatingContactActionsProps) {
  return (
    <div className="fixed bottom-6 left-6 z-30 hidden flex-col gap-2 md:flex">
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="التواصل عبر واتساب"
        className="group flex h-14 items-center gap-0 overflow-hidden rounded-2xl bg-emerald-600 px-4 text-white shadow-xl shadow-emerald-900/20 transition hover:-translate-y-1 hover:bg-emerald-700"
      >
        <MessageCircle className="h-6 w-6 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-black opacity-0 transition-all duration-300 group-hover:mr-2 group-hover:max-w-32 group-hover:opacity-100">
          تواصل معنا
        </span>
      </a>
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="العودة إلى أعلى الصفحة"
        className="grid h-11 w-11 place-items-center self-end rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-lg transition hover:-translate-y-1 hover:border-blue-200 hover:text-blue-700"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </div>
  );
}
