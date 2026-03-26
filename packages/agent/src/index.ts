import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAIProvider, OpenAIEmbeddingProvider } from "./llm-provider.js";
import { McpClient } from "./mcp-client.js";
import { SessionLock } from "./session-lock.js";
import { recoverUnanswered, subscribeToMessages, startHealthServer } from "./startup.js";
import { startScheduler } from "./scheduler.js";

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

const deps = { supabase, llm, embedding, mcp, sessionLock, systemPrompt };

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Backup Brain Agent starting...");

  // Initialize MCP client
  await mcp.initialize();
  console.log("MCP client connected.");

  // Health check server
  startHealthServer(HEALTH_PORT);

  // Recover unanswered messages from downtime
  await recoverUnanswered(deps);

  // Start scheduled jobs (reminder checker, proactive reviewer)
  startScheduler(supabase, { supabase, llm, embedding, mcp });

  // Subscribe to new user messages
  subscribeToMessages(deps);
  console.log("Agent ready — listening for messages.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
