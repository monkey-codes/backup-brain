import type { SupabaseClient } from "@supabase/supabase-js";
import type { LLMProvider, LLMMessage, ToolDefinition, EmbeddingProvider } from "./llm-provider.js";
import type { McpClient } from "./mcp-client.js";

const MAX_TOOL_ROUNDS = 10;

export interface ProcessContext {
  sessionId: string;
  userId: string;
  llm: LLMProvider;
  mcp: McpClient;
  tools: ToolDefinition[];
  systemPrompt: string;
  supabase: SupabaseClient;
  embedding: EmbeddingProvider;
}

export async function processMessage(ctx: ProcessContext): Promise<string> {
  // Load session history
  const { data: history } = await ctx.supabase
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", ctx.sessionId)
    .order("created_at", { ascending: true });

  const messages: LLMMessage[] = [
    { role: "system", content: ctx.systemPrompt },
    ...(history ?? []).map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  // ReAct loop: LLM may call tools multiple times before producing a final response
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await ctx.llm.chat(messages, ctx.tools);

    if (response.finish_reason === "stop" || response.tool_calls.length === 0) {
      return response.content ?? "";
    }

    // Record the assistant's tool-call message
    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.tool_calls,
    });

    // Execute each tool call and collect results
    for (const tc of response.tool_calls) {
      let result: string;
      try {
        const args = JSON.parse(tc.arguments);
        // Inject session_id, created_by, and embedding for capture_thought
        if (tc.name === "capture_thought") {
          args.session_id ??= ctx.sessionId;
          args.created_by ??= ctx.userId;
          if (!args.embedding && args.content) {
            args.embedding = await ctx.embedding.embed(args.content);
          }
        }
        result = await ctx.mcp.callTool(tc.name, args);
      } catch (error) {
        result = JSON.stringify({ error: String(error) });
      }

      messages.push({
        role: "tool",
        content: result,
        tool_call_id: tc.id,
      });
    }
  }

  return "I'm sorry, I got stuck in a processing loop. Please try again.";
}
