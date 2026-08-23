export type AdminAssistantMessageRole = 'user' | 'assistant';

// A small topic token preserves the meaning of a short follow-up such as
// "ما هي؟" without persisting or sending any conversation/customer data.
export type AdminAssistantContext =
  | 'monitoring'
  | 'inventory'
  | 'weekly_summary'
  | 'debts'
  | 'monthly_report'
  | 'orders'
  | 'daily_summary'
  | 'profit';

export interface AdminAssistantMessage {
  id: string;
  role: AdminAssistantMessageRole;
  content: string;
}

export interface AdminAssistantResponse {
  answer: string;
  context?: AdminAssistantContext;
  // The server returns this only after it found the product in the guarded
  // inventory snapshot. It lets a short next question such as "كم سعرها؟"
  // refer to the same product without storing the chat or customer data.
  productSku?: string;
}
