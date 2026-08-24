import React, { FormEvent, useState } from 'react';
import {
  BotMessageSquare,
  CircleAlert,
  LockKeyhole,
  PackageCheck,
  Send,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { askAdminAssistant } from '../../services/supabase/adminAssistant.service';
import type {
  AdminAssistantContext,
  AdminAssistantCard,
  AdminAssistantFactTone,
  AdminAssistantMessage,
} from '../../types/adminAssistant';

const quickPrompts = [
  'ما أهم الأمور التي تحتاج متابعة الآن؟',
  'أعطني ملخصاً مختصراً لأداء اليوم.',
  'أعطني التقرير الشهري الحالي.',
  'ما هي أصناف المخزون التي تحتاج تدخلاً؟',
  'ما وضع الذمم الحالية؟',
];

const newMessage = (
  role: AdminAssistantMessage['role'],
  content: string,
  card?: AdminAssistantCard,
): AdminAssistantMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  card,
});

const cardStyle = {
  info: {
    icon: TrendingUp,
    shell: 'border-blue-400/25 bg-blue-500/10',
    iconShell: 'bg-blue-500/15 text-blue-200',
    label: 'قراءة مباشرة من النظام',
  },
  success: {
    icon: PackageCheck,
    shell: 'border-emerald-400/25 bg-emerald-500/10',
    iconShell: 'bg-emerald-500/15 text-emerald-200',
    label: 'الوضع الحالي',
  },
  warning: {
    icon: CircleAlert,
    shell: 'border-amber-400/25 bg-amber-500/10',
    iconShell: 'bg-amber-500/15 text-amber-100',
    label: 'يحتاج متابعة',
  },
  danger: {
    icon: CircleAlert,
    shell: 'border-rose-400/25 bg-rose-500/10',
    iconShell: 'bg-rose-500/15 text-rose-100',
    label: 'تنبيه تشغيلي',
  },
} satisfies Record<AdminAssistantCard['tone'], {
  icon: typeof PackageCheck;
  shell: string;
  iconShell: string;
  label: string;
}>;

const factStyle = {
  default: 'text-slate-100',
  positive: 'text-emerald-300',
  warning: 'text-amber-200',
  danger: 'text-rose-200',
} satisfies Record<AdminAssistantFactTone, string>;

export const AdminAssistantView: React.FC = () => {
  const [messages, setMessages] = useState<AdminAssistantMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastContext, setLastContext] = useState<AdminAssistantContext | undefined>();
  const [lastProductSku, setLastProductSku] = useState<string | undefined>();

  const submit = async (event?: FormEvent, requestedMessage?: string) => {
    event?.preventDefault();
    const message = (requestedMessage || draft).trim();
    if (!message || isSubmitting) return;

    setError(null);
    setMessages((current) => [...current, newMessage('user', message)]);
    setDraft('');
    setIsSubmitting(true);

    try {
      const { answer, context, productSku, card } = await askAdminAssistant(
        message,
        lastContext,
        lastProductSku,
      );
      if (context) setLastContext(context);
      if (productSku) setLastProductSku(productSku);
      setMessages((current) => [...current, newMessage('assistant', answer, card)]);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'تعذر التواصل مع المساعد الآن.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div dir="rtl" className="mx-auto max-w-2xl space-y-3 p-3 pb-28 sm:p-4">
      <header className="overflow-hidden rounded-3xl border border-violet-500/20 bg-gradient-to-bl from-violet-500/15 via-slate-900 to-slate-950 p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[9px] font-black text-violet-200">
              <Sparkles className="h-3 w-3" />
              مساعد تشغيلي آمن
            </div>
            <h2 className="text-base font-black text-white">المساعد الإداري الذكي</h2>
            <p className="mt-1 max-w-md text-[10px] leading-5 text-slate-400">
              اسأل عن المخزون والذمم وحالة الطلبات وملخص اليوم والتقرير الشهري من بيانات النظام الحقيقية.
              لا يملك أي صلاحية لتعديل الطلبات أو الحسابات.
            </p>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-400/25 bg-violet-500/15 text-violet-200">
            <BotMessageSquare className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[9px] font-bold text-slate-400">
          <LockKeyhole className="h-3.5 w-3.5 text-emerald-400" />
          لا تُرسل أسماء العملاء أو هواتفهم أو عناوينهم إلى المساعد
        </div>
      </header>

      {messages.length === 0 && (
        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-3 shadow-sm">
          <p className="px-1 text-[11px] font-black text-slate-200">أسئلة جاهزة</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={isSubmitting}
                onClick={() => void submit(undefined, prompt)}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2.5 text-right text-[10px] font-bold leading-5 text-slate-300 transition hover:border-violet-500/40 hover:bg-violet-500/10 disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>
      )}

      {messages.length > 0 && (
        <section className="space-y-2 rounded-3xl border border-slate-800 bg-slate-950/55 p-3 shadow-sm">
          {messages.map((message) => {
            if (message.role === 'user') {
              return (
                <article key={message.id} className="mr-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-blue-600 px-3 py-2.5 text-[11px] font-bold leading-6 text-white shadow">
                  {message.content}
                </article>
              );
            }

            const card = message.card;
            const style = card ? cardStyle[card.tone] : undefined;
            const Icon = style?.icon ?? BotMessageSquare;
            return (
              <article key={message.id} className="ml-auto max-w-[94%] rounded-2xl rounded-tl-sm border border-violet-500/20 bg-slate-900 p-3 text-[11px] leading-6 text-slate-200 shadow">
                {card && style && (
                  <div className={`rounded-2xl border p-3 ${style.shell}`}>
                    <div className="flex items-start gap-2.5">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${style.iconShell}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-black text-slate-400">{style.label}</p>
                        <h3 className="mt-0.5 text-[12px] font-black text-white">{card.title}</h3>
                        {card.subtitle && <p className="mt-0.5 text-[10px] leading-5 text-slate-300">{card.subtitle}</p>}
                      </div>
                    </div>
                    {card.facts && card.facts.length > 0 && (
                      <dl className="mt-2.5 grid grid-cols-2 gap-1.5">
                        {card.facts.map((fact) => (
                          <div key={`${fact.label}-${fact.value}`} className="min-w-0 rounded-xl border border-white/8 bg-slate-950/35 px-2 py-1.5">
                            <dt className="truncate text-[8px] font-bold text-slate-400">{fact.label}</dt>
                            <dd className={`mt-0.5 truncate text-[10px] font-black ${factStyle[fact.tone ?? 'default']}`}>{fact.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {card.note && <p className="mt-2 text-[9px] leading-5 text-slate-300">{card.note}</p>}
                  </div>
                )}
                {message.content && <p className={`whitespace-pre-wrap ${card ? 'mt-2 px-0.5 text-[10px] text-slate-300' : ''}`}>{message.content}</p>}
                {card?.suggestions && card.suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {card.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => void submit(undefined, suggestion)}
                        className="rounded-xl border border-violet-400/20 bg-violet-500/10 px-2 py-1 text-[9px] font-black text-violet-100 transition hover:border-violet-300/45 hover:bg-violet-500/20 disabled:opacity-50"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
          {isSubmitting && (
            <div className="ml-auto flex w-fit items-center gap-2 rounded-2xl border border-violet-500/20 bg-slate-900 px-3 py-2 text-[10px] font-bold text-violet-200">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-300" />
              يحلل ملخص العمل...
            </div>
          )}
        </section>
      )}

      {error && (
        <div role="alert" className="rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-[10px] font-bold leading-5 text-red-200">
          {error}
        </div>
      )}

      <form onSubmit={(event) => void submit(event)} className="sticky bottom-2 rounded-3xl border border-slate-700 bg-slate-900/95 p-2 shadow-2xl backdrop-blur">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            maxLength={750}
            rows={2}
            disabled={isSubmitting}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="اكتب سؤالك عن العمل الحالي..."
            className="min-h-[48px] flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] leading-5 text-slate-100 outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!draft.trim() || isSubmitting}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="إرسال السؤال"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="px-1 pt-1.5 text-left text-[8px] text-slate-600">{draft.length}/750</p>
      </form>
    </div>
  );
};
