export type AdminAssistantMessageRole = 'user' | 'assistant';

// A small topic token preserves the meaning of a short follow-up such as
// "ما هي؟" without persisting or sending any conversation/customer data.
export type AdminAssistantContext =
  | 'monitoring'
  | 'inventory'
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
}
