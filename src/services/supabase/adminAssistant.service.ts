import { supabase } from '../../lib/supabase';
import type {
  AdminAssistantCard,
  AdminAssistantCardTone,
  AdminAssistantContext,
  AdminAssistantFactTone,
  AdminAssistantResponse,
} from '../../types/adminAssistant';

const MAX_MESSAGE_LENGTH = 750;

const isAssistantContext = (value: unknown): value is AdminAssistantContext =>
  value === 'monitoring' ||
  value === 'inventory' ||
  value === 'weekly_summary' ||
  value === 'debts' ||
  value === 'monthly_report' ||
  value === 'orders' ||
  value === 'daily_summary' ||
  value === 'profit';

const asProductSku = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128
    ? value.trim()
    : undefined;

const isCardTone = (value: unknown): value is AdminAssistantCardTone =>
  value === 'info' || value === 'success' || value === 'warning' || value === 'danger';

const isFactTone = (value: unknown): value is AdminAssistantFactTone =>
  value === 'default' || value === 'positive' || value === 'warning' || value === 'danger';

const asDisplayText = (value: unknown, maxLength: number) =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : undefined;

const asAssistantCard = (value: unknown): AdminAssistantCard | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const title = asDisplayText(candidate.title, 120);
  if (!title || !isCardTone(candidate.tone)) return undefined;

  const facts = Array.isArray(candidate.facts)
    ? candidate.facts.slice(0, 6).flatMap((fact) => {
      if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return [];
      const item = fact as Record<string, unknown>;
      const label = asDisplayText(item.label, 64);
      const factValue = asDisplayText(item.value, 120);
      return label && factValue
        ? [{ label, value: factValue, ...(isFactTone(item.tone) ? { tone: item.tone } : {}) }]
        : [];
    })
    : undefined;

  const suggestions = Array.isArray(candidate.suggestions)
    ? candidate.suggestions
      .slice(0, 4)
      .flatMap((suggestion) => {
        const text = asDisplayText(suggestion, 160);
        return text ? [text] : [];
      })
    : undefined;

  return {
    title,
    tone: candidate.tone,
    ...(asDisplayText(candidate.subtitle, 180) ? { subtitle: asDisplayText(candidate.subtitle, 180) } : {}),
    ...(facts?.length ? { facts } : {}),
    ...(asDisplayText(candidate.note, 240) ? { note: asDisplayText(candidate.note, 240) } : {}),
    ...(suggestions?.length ? { suggestions } : {}),
  };
};

export const askAdminAssistant = async (
  message: string,
  context?: AdminAssistantContext,
  productSku?: string,
): Promise<AdminAssistantResponse> => {
  const normalizedMessage = message.trim();
  if (!normalizedMessage || normalizedMessage.length > MAX_MESSAGE_LENGTH) {
    throw new Error('اكتب سؤالاً بين 1 و750 حرفاً.');
  }

  const { data, error } = await supabase.functions.invoke<AdminAssistantResponse>(
    'admin-ai-assistant',
    { body: { message: normalizedMessage, context, productSku } },
  );

  if (error) {
    throw new Error(error.message || 'تعذر التواصل مع المساعد الآن.');
  }

  if (!data || typeof data.answer !== 'string' || !data.answer.trim()) {
    throw new Error('تعذر الحصول على إجابة قابلة للعرض.');
  }

  return {
    answer: data.answer.trim(),
    context: isAssistantContext(data.context) ? data.context : undefined,
    productSku: asProductSku(data.productSku),
    card: asAssistantCard(data.card),
  };
};
