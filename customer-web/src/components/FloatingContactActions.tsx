import { ArrowUp, MessageCircle } from 'lucide-react';
import { SEO_BRAND } from '../config/seoBrand';

interface FloatingContactActionsProps {
  whatsappUrl: string;
}

export function FloatingContactActions({
  whatsappUrl,
}: FloatingContactActionsProps) {
  return (
    <aside aria-label="روابط التواصل السريع" className="fixed bottom-6 left-6 z-30 hidden flex-col items-start gap-2 md:flex">
      <div className="flex flex-col gap-2 rounded-[1.4rem] border border-white/80 bg-white/85 p-2 shadow-2xl shadow-slate-950/15 backdrop-blur-xl">
        <a
          href={SEO_BRAND.socialProfiles[0]}
          target="_blank"
          rel="noreferrer"
          aria-label="متابعة محلات النواصرة على فيسبوك"
          className="group flex h-12 min-w-12 items-center overflow-hidden rounded-2xl bg-[#1877f2] px-3.5 text-white transition hover:-translate-y-0.5 hover:bg-[#0f68da] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
        >
          <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center font-serif text-[1.7rem] font-black leading-none">f</span>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-black opacity-0 transition-all duration-300 group-hover:mr-2 group-hover:max-w-28 group-hover:opacity-100 group-focus-visible:mr-2 group-focus-visible:max-w-28 group-focus-visible:opacity-100">
            فيسبوك
          </span>
        </a>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="التواصل عبر واتساب"
          className="group flex h-12 min-w-12 items-center overflow-hidden rounded-2xl bg-emerald-600 px-3.5 text-white transition hover:-translate-y-0.5 hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200"
        >
          <MessageCircle className="h-6 w-6 shrink-0" />
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-black opacity-0 transition-all duration-300 group-hover:mr-2 group-hover:max-w-32 group-hover:opacity-100 group-focus-visible:mr-2 group-focus-visible:max-w-32 group-focus-visible:opacity-100">
            واتساب
          </span>
        </a>
      </div>
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="العودة إلى أعلى الصفحة"
        className="grid h-11 w-11 place-items-center self-center rounded-2xl border border-slate-200 bg-white/95 text-slate-600 shadow-lg transition hover:-translate-y-0.5 hover:border-blue-200 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </aside>
  );
}
