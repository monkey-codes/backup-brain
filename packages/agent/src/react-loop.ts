import type { SupabaseClient } from "@supabase/supabase-js";
import type { LLMProvider, LLMMessage, ToolDefinition, EmbeddingProvider } from "./llm-provider.js";
import type { McpClient } from "./mcp-client.js";

const MAX_TOOL_ROUNDS = 10;

/**
 * Rewrite tool schemas for LLM consumption.
 * The MCP server's `search_thoughts` expects a raw embedding vector,
 * but the LLM should provide a natural-language query instead.
 */
export function rewriteToolsForLLM(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((t) => {
    if (t.name === "search_thoughts") {
      return {
        name: t.name,
        description:
          "Search thoughts by semantic similarity. Provide a natural-language query describing what to find.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural-language search query",
            },
            match_threshold: {
              type: "number",
              description: "Minimum similarity threshold (0-1, default 0.5)",
            },
            match_count: {
              type: "number",
              description: "Maximum results to return (1-50, default 10)",
            },
          },
          required: ["query"],
        },
      };
    }
    return t;
  });
}

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
  // Load session history, session metadata, and past corrections in parallel
  const [{ data: history }, { data: session }, correctionsResult] = await Promise.all([
    ctx.supabase
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", ctx.sessionId)
      .order("created_at", { ascending: true }),
    ctx.supabase
      .from("chat_sessions")
      .select("title")
      .eq("id", ctx.sessionId)
      .single(),
    ctx.mcp.callTool("list_decisions", { review_status: "corrected", limit: 50 }).catch(() => "[]"),
  ]);

  // Build corrections context from past user corrections
  let correctionsContext = "";
  try {
    const corrections = JSON.parse(correctionsResult);
    if (Array.isArray(corrections) && corrections.length > 0) {
      const formatted = corrections.map((c: Record<string, unknown>) =>
        `- [${c.decision_type}] Original: ${JSON.stringify(c.value)} → Corrected: ${JSON.stringify(c.corrected_value)} (reasoning was: "${c.reasoning}")`
      ).join("\n");
      correctionsContext = `\n\n## Past corrections\n\nThe following decisions were corrected by the user. Learn from these to avoid repeating the same mistakes:\n\n${formatted}`;
    }
  } catch {
    // If parsing fails, proceed without corrections
  }

  // Inject session context so the LLM knows whether to set a title
  const sessionTitle = session?.title;
  const sessionContext = sessionTitle
    ? `\n\n## Current session\n\nSession ID: ${ctx.sessionId}\nSession title: "${sessionTitle}"\n\nThe session already has a title — do not call \`set_session_title\`.`
    : `\n\n## Current session\n\nSession ID: ${ctx.sessionId}\nSession title: (none)\n\nThis session has no title yet. Call \`set_session_title\` with a short, descriptive title based on the conversation content.`;

  const messages: LLMMessage[] = [
    { role: "system", content: ctx.systemPrompt + correctionsContext + sessionContext },
    ...(history ?? []).map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  // Rewrite tool schemas so the LLM sees query-based search instead of raw embeddings
  const llmTools = rewriteToolsForLLM(ctx.tools);

  // ReAct loop: LLM may call tools multiple times before producing a final response
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await ctx.llm.chat(messages, llmTools);

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
        // Inject embedding for search_thoughts — LLM provides a query string,
        // system converts it to a vector before calling the MCP tool
        if (tc.name === "search_thoughts") {
          if (!args.embedding && args.query) {
            args.embedding = await ctx.embedding.embed(args.query);
            delete args.query;
          }
        }
        // Inject session_id for set_session_title
        if (tc.name === "set_session_title") {
          args.session_id ??= ctx.sessionId;
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
