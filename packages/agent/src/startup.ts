import { createServer, type Server } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LLMProvider, EmbeddingProvider } from "./llm-provider.js";
import type { McpClient } from "./mcp-client.js";
import type { SessionLock } from "./session-lock.js";
import {
  SupabaseChatContextLoader,
  type CorrectionRecord,
} from "./chat-context-loader.js";
import { ReactLoopExecutor } from "./react-loop-executor.js";

// ---------------------------------------------------------------------------
// Dependencies — injected by the entry point
// ---------------------------------------------------------------------------

export interface AgentDeps {
  supabase: SupabaseClient;
  llm: LLMProvider;
  embedding: EmbeddingProvider;
  mcp: McpClient;
  sessionLock: SessionLock;
  systemPrompt: string;
}

// ---------------------------------------------------------------------------
// System prompt builders
// ---------------------------------------------------------------------------

function buildCorrectionsContext(corrections: CorrectionRecord[]): string {
  if (corrections.length === 0) return "";

  const formatted = corrections
    .map(
      (c) =>
        `- [${c.decision_type}] Original: ${JSON.stringify(c.value)} → Corrected: ${JSON.stringify(c.corrected_value)} (reasoning was: "${c.reasoning}")`
    )
    .join("\n");

  return `\n\n## Past corrections\n\nThe following decisions were corrected by the user. Learn from these to avoid repeating the same mistakes:\n\n${formatted}`;
}

function buildDateContext(): string {
  const now = new Date();
  const iso = now.toISOString();
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  return `\n\n## Current date and time\n\nToday is ${dayOfWeek}, ${iso}. Use this to resolve relative dates like "next week", "in 3 days", "tomorrow", etc. into absolute ISO 8601 datetimes.`;
}

function buildSessionContext(
  sessionId: string,
  sessionTitle: string | null
): string {
  return sessionTitle
    ? `\n\n## Current session\n\nSession ID: ${sessionId}\nSession title: "${sessionTitle}"\n\nThe session already has a title — do not call \`set_session_title\`.`
    : `\n\n## Current session\n\nSession ID: ${sessionId}\nSession title: (none)\n\nThis session has no title yet. Call \`set_session_title\` with a short, descriptive title based on the conversation content.`;
}

// ---------------------------------------------------------------------------
// Message processing with retry + error handling
// ---------------------------------------------------------------------------

export async function handleUserMessage(
  deps: AgentDeps,
  sessionId: string,
  userId: string
): Promise<void> {
  const release = await deps.sessionLock.acquire(sessionId);
  try {
    const response = await processChat(deps, sessionId, userId);

    await deps.supabase.from("chat_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: response,
    });
  } catch (error) {
    console.error(`Error processing session ${sessionId}, retrying...`, error);

    // Retry once
    try {
      const response = await processChat(deps, sessionId, userId);

      await deps.supabase.from("chat_messages").insert({
        session_id: sessionId,
        role: "assistant",
        content: response,
      });
    } catch (retryError) {
      console.error(`Retry failed for session ${sessionId}:`, retryError);

      await deps.supabase.from("chat_messages").insert({
        session_id: sessionId,
        role: "assistant",
        content:
          "I'm sorry, I encountered an error processing your message. Please try again.",
      });
    }
  } finally {
    release();
  }
}

async function processChat(
  deps: AgentDeps,
  sessionId: string,
  userId: string
): Promise<string> {
  const contextLoader = new SupabaseChatContextLoader(deps.supabase, deps.mcp);

  const [history, title, corrections] = await Promise.all([
    contextLoader.loadHistory(sessionId),
    contextLoader.loadSessionTitle(sessionId),
    contextLoader.loadCorrections(),
  ]);

  const fullSystemPrompt =
    deps.systemPrompt +
    buildDateContext() +
    buildCorrectionsContext(corrections) +
    buildSessionContext(sessionId, title);

  const tools = await deps.mcp.listTools();
  const executor = new ReactLoopExecutor(deps.llm, deps.embedding, deps.mcp);

  const result = await executor.run({
    systemPrompt: fullSystemPrompt,
    messages: history,
    tools,
    argInjections: {
      capture_thought: (args) => {
        args.session_id = sessionId;
        args.created_by = userId;
      },
      set_session_title: (args) => {
        args.session_id = sessionId;
      },
    },
  });

  return result.content;
}

// ---------------------------------------------------------------------------
// Startup recovery — process unanswered messages
// ---------------------------------------------------------------------------

export async function recoverUnanswered(deps: AgentDeps): Promise<void> {
  // Prefer the dedicated SQL function
  const { data: unanswered, error } = await deps.supabase.rpc(
    "get_unanswered_messages"
  );

  if (error) {
    // Fallback: simpler query — find sessions with a user message as the latest message
    console.warn("get_unanswered_messages RPC not found, using fallback query");
    const { data: sessions } = await deps.supabase
      .from("chat_messages")
      .select("session_id, role, created_at")
      .order("created_at", { ascending: false });

    if (!sessions?.length) return;

    // Group by session, find ones where latest message is from user
    const sessionLatest = new Map<
      string,
      { role: string; created_at: string }
    >();
    for (const msg of sessions) {
      if (!sessionLatest.has(msg.session_id)) {
        sessionLatest.set(msg.session_id, msg);
      }
    }

    for (const [sessionId, latest] of sessionLatest) {
      if (latest.role === "user") {
        const { data: session } = await deps.supabase
          .from("chat_sessions")
          .select("user_id")
          .eq("id", sessionId)
          .single();

        if (session) {
          console.log(`Recovering unanswered message in session ${sessionId}`);
          await handleUserMessage(deps, sessionId, session.user_id);
        }
      }
    }
    return;
  }

  if (!unanswered?.length) {
    console.log("No unanswered messages to recover.");
    return;
  }

  // Process in chronological order
  for (const msg of unanswered) {
    console.log(`Recovering unanswered message in session ${msg.session_id}`);
    await handleUserMessage(deps, msg.session_id, msg.user_id);
  }
}

// ---------------------------------------------------------------------------
// Realtime subscription
// ---------------------------------------------------------------------------

export function subscribeToMessages(deps: AgentDeps): void {
  deps.supabase
    .channel("agent-messages")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: "role=eq.user",
      },
      async (payload) => {
        const { session_id } = payload.new as { session_id: string };

        const { data: session } = await deps.supabase
          .from("chat_sessions")
          .select("user_id")
          .eq("id", session_id)
          .single();

        if (!session) {
          console.error(`Session ${session_id} not found`);
          return;
        }

        handleUserMessage(deps, session_id, session.user_id).catch((err) =>
          console.error("Unhandled error in message handler:", err)
        );
      }
    )
    .subscribe((status) => {
      console.log(`Realtime subscription status: ${status}`);
    });
}

// ---------------------------------------------------------------------------
// Health check server
// ---------------------------------------------------------------------------

export function startHealthServer(port: number): Server {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });

  server.listen(port, () => {
    console.log(`Health check server listening on port ${port}`);
  });

  return server;
}
