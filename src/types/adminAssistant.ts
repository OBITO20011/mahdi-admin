export type AdminAssistantMessageRole = 'user' | 'assistant';

export type AdminAssistantCardTone = 'info' | 'success' | 'warning' | 'danger';

export type AdminAssistantFactTone = 'default' | 'positive' | 'warning' | 'danger';

export interface AdminAssistantFact {
  label: string;
  value: string;
  tone?: AdminAssistantFactTone;
}

// The Edge Function creates these cards only from authenticated RPC output.
// They deliberately contain operational totals and product facts, never a
// customer's name, phone number, or address.
export interface AdminAssistantCard {
  title: string;
  subtitle?: string;
  tone: AdminAssistantCardTone;
  facts?: AdminAssistantFact[];
  note?: string;
  suggestions?: string[];
}

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
  card?: AdminAssistantCard;
}

export interface AdminAssistantResponse {
  answer: string;
  context?: AdminAssistantContext;
  card?: AdminAssistantCard;
  // The server returns this only after it found the product in the guarded
  // inventory snapshot. It lets a short next question such as "كم سعرها؟"
  // refer to the same product without storing the chat or customer data.
  productSku?: string;
}
