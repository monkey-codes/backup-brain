import type { SupabaseClient } from "@supabase/supabase-js";
import type { LLMMessage } from "./llm-provider.js";
import type { ToolExecutor } from "./mcp-client.js";

// ---------------------------------------------------------------------------
// ChatContextLoader port
// ---------------------------------------------------------------------------

export interface CorrectionRecord {
  id: string;
  decision_type: string;
  value: Record<string, unknown>;
  corrected_value: Record<string, unknown>;
  reasoning: string;
  review_status: string;
}

export interface ChatContextLoader {
  loadHistory(sessionId: string): Promise<LLMMessage[]>;
  loadSessionTitle(sessionId: string): Promise<string | null>;
  loadCorrections(): Promise<CorrectionRecord[]>;
}

// ---------------------------------------------------------------------------
// Supabase adapter
// ---------------------------------------------------------------------------

export class SupabaseChatContextLoader implements ChatContextLoader {
  constructor(
    private supabase: SupabaseClient,
    private toolExecutor: ToolExecutor
  ) {}

  async loadHistory(sessionId: string): Promise<LLMMessage[]> {
    const { data: history } = await this.supabase
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    return (history ?? []).map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  }

  async loadSessionTitle(sessionId: string): Promise<string | null> {
    const { data: session } = await this.supabase
      .from("chat_sessions")
      .select("title")
      .eq("id", sessionId)
      .single();

    return session?.title ?? null;
  }

  async loadCorrections(): Promise<CorrectionRecord[]> {
    try {
      const result = await this.toolExecutor.callTool("list_decisions", {
        review_status: "corrected",
        limit: 50,
      });
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }
}
