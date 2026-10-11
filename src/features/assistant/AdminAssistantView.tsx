import React, { FormEvent, useState } from 'react';
import {Card, FormFields, UiButton} from '../../components/ui';
import {
  BotMessageSquare,
  CircleAlert,
  LockKeyhole,
  PackageCheck,
  RotateCcw,
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

const quickPromptGroups = [
  {
    title: 'متابعة اليوم',
    prompts: [
      'ما أهم الأمور التي تحتاج متابعة الآن؟',
      'ما هي حالة الطلبات؟',
      'أعطني ملخصاً مختصراً لأداء اليوم.',
    ],
  },
  {
    title: 'المخزون والحسابات',
    prompts: [
      'ما هي أصناف المخزون التي تحتاج تدخلاً؟',
      'ما وضع الذمم الحالية؟',
      'أعطني التقرير الشهري الحالي.',
    ],
  },
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
    shell: 'border-nw-border bg-nw-info-bg',
    iconShell: 'bg-nw-info-bg text-nw-info',
    label: 'قراءة مباشرة من النظام',
  },
  success: {
    icon: PackageCheck,
    shell: 'border-nw-border bg-nw-ok-bg',
    iconShell: 'bg-nw-ok-bg text-nw-ok',
    label: 'الوضع الحالي',
  },
  warning: {
    icon: CircleAlert,
    shell: 'border-nw-border bg-nw-warn-bg',
    iconShell: 'bg-nw-warn-bg text-nw-warn',
    label: 'يحتاج متابعة',
  },
  danger: {
    icon: CircleAlert,
    shell: 'border-nw-border bg-nw-bad-bg',
    iconShell: 'bg-nw-bad-bg text-nw-bad',
    label: 'تنبيه تشغيلي',
  },
} satisfies Record<AdminAssistantCard['tone'], {
  icon: typeof PackageCheck;
  shell: string;
  iconShell: string;
  label: string;
}>;

const factStyle = {
  default: 'text-nw-text',
  positive: 'text-nw-ok',
  warning: 'text-nw-warn',
  danger: 'text-nw-bad',
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

  const clearConversation = () => {
    if (isSubmitting) return;
    setMessages([]);
    setLastContext(undefined);
    setLastProductSku(undefined);
    setError(null);
  };

  return (
    <div dir="rtl" className="mx-auto max-w-2xl space-y-3 p-3 pb-28 sm:p-4">
      <header className="overflow-hidden rounded-3xl border border-nw-border     p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-nw-border bg-nw-info-bg px-2.5 py-1 text-[9px] font-black text-nw-info">
              <Sparkles className="h-3 w-3" />
              مساعد تشغيلي آمن
            </div>
            <h2 className="text-base font-black text-nw-text">المساعد الإداري الذكي</h2>
            <p className="mt-1 max-w-md text-[10px] leading-5 text-nw-muted">
              اسأل بطريقتك عن المخزون والذمم وحالة الطلبات وملخص اليوم والتقرير الشهري من بيانات النظام الحقيقية.
              لا يملك أي صلاحية لتعديل الطلبات أو الحسابات.
            </p>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-nw-border bg-nw-info-bg text-nw-info">
            <BotMessageSquare className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[9px] font-bold text-nw-muted">
          <LockKeyhole className="h-3.5 w-3.5 text-nw-ok" />
          لا تُرسل أسماء العملاء أو هواتفهم أو عناوينهم إلى المساعد
        </div>
      </header>

      {messages.length === 0 && (
        <Card className="space-y-2">
          <p className="px-1 text-[11px] font-black text-nw-text">ابدأ بسؤال جاهز أو اكتب سؤالك</p>
          <div className="mt-2 space-y-3">
            {quickPromptGroups.map((group) => (
              <div key={group.title}>
                <p className="px-1 text-[9px] font-black text-nw-muted">{group.title}</p>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {group.prompts.map((prompt) => (
                    <UiButton variant="plain"
                      key={prompt}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void submit(undefined, prompt)}
                      className="rounded-2xl border border-nw-border bg-nw-bg px-3 py-2.5 text-right text-[10px] font-bold leading-5 text-nw-muted transition hover:border-nw-border hover:bg-nw-info-bg disabled:opacity-50"
                    >
                      {prompt}
                    </UiButton>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {messages.length > 0 && (
        <section className="space-y-2 rounded-3xl border border-nw-border bg-nw-bg p-3 shadow-sm">
          <div className="flex items-center justify-between border-b border-nw-border pb-2">
            <p className="text-[10px] font-black text-nw-muted">المحادثة الحالية</p>
            <UiButton variant="plain"
              type="button"
              onClick={clearConversation}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[9px] font-black text-nw-muted transition hover:bg-nw-surface-2 hover:text-nw-text disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              بدء من جديد
            </UiButton>
          </div>
          {messages.map((message) => {
            if (message.role === 'user') {
              return (
                <article key={message.id} className="mr-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-nw-primary px-3 py-2.5 text-[11px] font-bold leading-6 text-nw-on-primary shadow">
                  {message.content}
                </article>
              );
            }

            const card = message.card;
            const style = card ? cardStyle[card.tone] : undefined;
            const Icon = style?.icon ?? BotMessageSquare;
            return (
              <article key={message.id} className="ml-auto max-w-[94%] rounded-2xl rounded-tl-sm border border-nw-border bg-nw-surface p-3 text-[11px] leading-6 text-nw-text shadow">
                {card && style && (
                  <div className={`rounded-2xl border p-3 ${style.shell}`}>
                    <div className="flex items-start gap-2.5">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${style.iconShell}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-black text-nw-muted">{style.label}</p>
                        <h3 className="mt-0.5 text-[12px] font-black text-nw-text">{card.title}</h3>
                        {card.subtitle && <p className="mt-0.5 text-[10px] leading-5 text-nw-muted">{card.subtitle}</p>}
                      </div>
                    </div>
                    {card.facts && card.facts.length > 0 && (
                      <dl className="mt-2.5 grid grid-cols-2 gap-1.5">
                        {card.facts.map((fact) => (
                          <div key={`${fact.label}-${fact.value}`} className="min-w-0 rounded-xl border border-nw-border bg-nw-bg px-2 py-1.5">
                            <dt className="truncate text-[8px] font-bold text-nw-muted">{fact.label}</dt>
                            <dd className={`mt-0.5 truncate text-[10px] font-black ${factStyle[fact.tone ?? 'default']}`}>{fact.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {card.note && <p className="mt-2 text-[9px] leading-5 text-nw-muted">{card.note}</p>}
                  </div>
                )}
                {message.content && <p className={`whitespace-pre-wrap ${card ? 'mt-2 px-0.5 text-[10px] text-nw-muted' : ''}`}>{message.content}</p>}
                {card?.suggestions && card.suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {card.suggestions.map((suggestion) => (
                      <UiButton variant="plain"
                        key={suggestion}
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => void submit(undefined, suggestion)}
                        className="rounded-xl border border-nw-border bg-nw-info-bg px-2 py-1 text-[9px] font-black text-nw-info transition hover:border-nw-border hover:bg-nw-info-bg disabled:opacity-50"
                      >
                        {suggestion}
                      </UiButton>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
          {isSubmitting && (
            <div className="ml-auto flex w-fit items-center gap-2 rounded-2xl border border-nw-border bg-nw-surface px-3 py-2 text-[10px] font-bold text-nw-info">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-nw-info-bg" />
              يحلل ملخص العمل...
            </div>
          )}
        </section>
      )}

      {error && (
        <div role="alert" className="rounded-2xl border border-nw-border bg-nw-bad-bg px-3 py-2.5 text-[10px] font-bold leading-5 text-nw-bad">
          {error}
        </div>
      )}

      <FormFields className="sticky bottom-2"><form onSubmit={(event) => void submit(event)} aria-busy={isSubmitting} className="rounded-2xl border border-nw-border bg-nw-surface p-2 shadow-sm">
        <div className="flex items-end gap-2">
          <textarea
            aria-label="سؤالك للمساعد"
            value={draft}
            maxLength={750}
            rows={2}
            disabled={isSubmitting}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="اكتب سؤالك عن العمل الحالي..."
            className="min-h-[48px] min-w-0 flex-1 resize-none rounded-2xl border border-nw-border bg-nw-bg px-3 py-2 text-sm leading-5 text-nw-text outline-none placeholder:text-nw-muted focus:border-nw-primary disabled:opacity-60"
          />
          <UiButton variant="plain"
            type="submit"
            disabled={!draft.trim() || isSubmitting}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-nw-primary text-nw-on-primary shadow-lg transition hover:bg-nw-primary disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="إرسال السؤال"
          >
            <Send className="h-4 w-4" />
          </UiButton>
        </div>
        <p className="px-1 pt-1.5 text-left text-[8px] text-nw-muted">{draft.length}/750</p>
      </form></FormFields>
    </div>
  );
};
