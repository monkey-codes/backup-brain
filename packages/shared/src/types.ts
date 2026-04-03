export interface ChatSession {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface Thought {
  id: string;
  content: string;
  embedding?: number[];
  session_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type DecisionType =
  | "classification"
  | "entity"
  | "reminder"
  | "tag"
  | "todo";

export type ReviewStatus = "pending" | "accepted" | "corrected";

export interface ClassificationValue {
  category: string;
}

export interface EntityValue {
  name: string;
  type: string;
}

export interface ReminderValue {
  due_at: string;
  description: string;
}

export interface TagValue {
  label: string;
}

export interface TodoValue {
  description: string;
  completed_at: string | null;
}

export type DecisionValue =
  | ClassificationValue
  | EntityValue
  | ReminderValue
  | TagValue
  | TodoValue;

export interface ThoughtDecision {
  id: string;
  thought_id: string;
  decision_type: DecisionType;
  value: DecisionValue;
  confidence: number;
  reasoning: string;
  review_status: ReviewStatus;
  corrected_value: DecisionValue | null;
  corrected_by: string | null;
  corrected_at: string | null;
  created_at: string;
}

export interface ThoughtGroup {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ThoughtGroupMember {
  thought_id: string;
  group_id: string;
  added_at: string;
}

export type NotificationType = "reminder" | "suggestion" | "insight";

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  thought_id: string | null;
  decision_id: string | null;
  delivered_via: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

export interface AgentState {
  key: string;
  value: unknown;
  updated_at: string;
}
