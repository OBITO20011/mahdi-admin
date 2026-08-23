import { supabase } from '../../lib/supabase';
import type { AdminAssistantResponse } from '../../types/adminAssistant';

const MAX_MESSAGE_LENGTH = 750;

export const askAdminAssistant = async (message: string): Promise<AdminAssistantResponse> => {
  const normalizedMessage = message.trim();
  if (!normalizedMessage || normalizedMessage.length > MAX_MESSAGE_LENGTH) {
    throw new Error('اكتب سؤالاً بين 1 و750 حرفاً.');
  }

  const { data, error } = await supabase.functions.invoke<AdminAssistantResponse>(
    'admin-ai-assistant',
    { body: { message: normalizedMessage } },
  );

  if (error) {
    throw new Error(error.message || 'تعذر التواصل مع المساعد الآن.');
  }

  if (!data || typeof data.answer !== 'string' || !data.answer.trim()) {
    throw new Error('تعذر الحصول على إجابة قابلة للعرض.');
  }

  return { answer: data.answer.trim() };
};
