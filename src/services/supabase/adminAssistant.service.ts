import { supabase } from '../../lib/supabase';
import type {
  AdminAssistantContext,
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
  };
};
