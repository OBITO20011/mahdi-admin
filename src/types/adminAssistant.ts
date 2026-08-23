export type AdminAssistantMessageRole = 'user' | 'assistant';

export interface AdminAssistantMessage {
  id: string;
  role: AdminAssistantMessageRole;
  content: string;
}

export interface AdminAssistantResponse {
  answer: string;
}
