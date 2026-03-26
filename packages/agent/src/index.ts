import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { OpenAIProvider, OpenAIEmbeddingProvider } from "./llm-provider.js";
import { McpClient } from "./mcp-client.js";
import { SessionLock } from "./session-lock.js";
import { processMessage } from "./react-loop.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:54321/functions/v1/mcp";
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT ?? "3001", 10);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(resolve(__dirname, "../prompts/system.md"), "utf-8");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const llm = new OpenAIProvider(OPENAI_API_KEY);
const embedding = new OpenAIEmbeddingProvider(OPENAI_API_KEY);
const mcp = new McpClient(MCP_URL);
const sessionLock = new SessionLock();

// ---------------------------------------------------------------------------
// Message processing with retry + error handling
// ---------------------------------------------------------------------------

async function handleUserMessage(sessionId: string, userId: string): Promise<void> {
  const release = await sessionLock.acquire(sessionId);
  try {
    const tools = await mcp.listTools();
    const response = await processMessage({
      sessionId,
      userId,
      llm,
      mcp,
      tools,
      systemPrompt,
      supabase,
      embedding,
    });

    await supabase.from("chat_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: response,
    });
  } catch (error) {
    console.error(`Error processing session ${sessionId}, retrying...`, error);

    // Retry once
    try {
      const tools = await mcp.listTools();
      const response = await processMessage({
        sessionId,
        userId,
        llm,
        mcp,
        tools,
        systemPrompt,
        supabase,
        embedding,
      });

      await supabase.from("chat_messages").insert({
        session_id: sessionId,
        role: "assistant",
        content: response,
      });
    } catch (retryError) {
      console.error(`Retry failed for session ${sessionId}:`, retryError);

      await supabase.from("chat_messages").insert({
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

// ---------------------------------------------------------------------------
// Startup recovery — process unanswered messages
// ---------------------------------------------------------------------------

async function recoverUnanswered(): Promise<void> {
  // Find user messages that have no assistant response after them in the same session
  const { data: unanswered, error } = await supabase.rpc("get_unanswered_messages");

  if (error) {
    // Fallback: simpler query — find sessions with a user message as the latest message
    console.warn("get_unanswered_messages RPC not found, using fallback query");
    const { data: sessions } = await supabase
      .from("chat_messages")
      .select("session_id, role, created_at")
      .order("created_at", { ascending: false });

    if (!sessions?.length) return;

    // Group by session, find ones where latest message is from user
    const sessionLatest = new Map<string, { role: string; created_at: string }>();
    for (const msg of sessions) {
      if (!sessionLatest.has(msg.session_id)) {
        sessionLatest.set(msg.session_id, msg);
      }
    }

    for (const [sessionId, latest] of sessionLatest) {
      if (latest.role === "user") {
        // Get the user_id from the session
        const { data: session } = await supabase
          .from("chat_sessions")
          .select("user_id")
          .eq("id", sessionId)
          .single();

        if (session) {
          console.log(`Recovering unanswered message in session ${sessionId}`);
          await handleUserMessage(sessionId, session.user_id);
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
    await handleUserMessage(msg.session_id, msg.user_id);
  }
}

// ---------------------------------------------------------------------------
// Realtime subscription
// ---------------------------------------------------------------------------

function subscribeToMessages(): void {
  supabase
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

        // Look up the session owner
        const { data: session } = await supabase
          .from("chat_sessions")
          .select("user_id")
          .eq("id", session_id)
          .single();

        if (!session) {
          console.error(`Session ${session_id} not found`);
          return;
        }

        handleUserMessage(session_id, session.user_id).catch((err) =>
          console.error("Unhandled error in message handler:", err),
        );
      },
    )
    .subscribe((status) => {
      console.log(`Realtime subscription status: ${status}`);
    });
}

// ---------------------------------------------------------------------------
// Health check server
// ---------------------------------------------------------------------------

function startHealthServer(): void {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });

  server.listen(HEALTH_PORT, () => {
    console.log(`Health check server listening on port ${HEALTH_PORT}`);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Backup Brain Agent starting...");

  // Initialize MCP client
  await mcp.initialize();
  console.log("MCP client connected.");

  // Health check server
  startHealthServer();

  // Recover unanswered messages from downtime
  await recoverUnanswered();

  // Subscribe to new user messages
  subscribeToMessages();
  console.log("Agent ready — listening for messages.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
