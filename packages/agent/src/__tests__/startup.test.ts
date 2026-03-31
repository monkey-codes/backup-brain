import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  recoverUnanswered,
  handleUserMessage,
  startHealthServer,
  type AgentDeps,
} from "../startup.js";
import type {
  LLMProvider,
  LLMResponse,
  EmbeddingProvider,
} from "../llm-provider.js";
import type { McpClient } from "../mcp-client.js";
import { SessionLock } from "../session-lock.js";
import type { Server } from "node:http";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLLM(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => {
      if (callIndex >= responses.length) {
        throw new Error(`Unexpected LLM call #${callIndex + 1}`);
      }
      return responses[callIndex++];
    }),
  };
}

function createMockEmbedding(): EmbeddingProvider {
  return { embed: vi.fn(async () => new Array(1536).fill(0.1)) };
}

function createMockMcp(): McpClient {
  return {
    callTool: vi.fn(async () => "{}"),
    listTools: vi.fn(async () => []),
    initialize: vi.fn(async () => {}),
  } as unknown as McpClient;
}

/**
 * Build a chainable mock for Supabase's query builder.
 * Each call records what was passed and returns the chain.
 * The terminal method (order / single) returns the configured result.
 */
function createMockSupabase(config: {
  rpcResult?: { data: unknown; error: unknown };
  messagesResult?: { data: unknown; error: unknown };
  sessionResult?: { data: unknown; error: unknown };
  insertFn?: ReturnType<typeof vi.fn>;
}) {
  const insertFn = config.insertFn ?? vi.fn(async () => ({ error: null }));

  return {
    rpc: vi.fn(async () => config.rpcResult ?? { data: [], error: null }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    from: vi.fn((table: string) => {
      if (table === "chat_messages") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(
                () => config.messagesResult ?? { data: [], error: null }
              ),
            })),
            order: vi.fn(
              () => config.messagesResult ?? { data: [], error: null }
            ),
          })),
          insert: insertFn,
        };
      }
      if (table === "chat_sessions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(
                () => config.sessionResult ?? { data: null, error: null }
              ),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({ data: [], error: null })),
            single: vi.fn(() => ({ data: null, error: null })),
          })),
        })),
        insert: insertFn,
      };
    }),
  } as unknown as AgentDeps["supabase"];
}

function makeDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  return {
    supabase: createMockSupabase({}),
    llm: createMockLLM([
      { content: "OK", tool_calls: [], finish_reason: "stop" },
    ]),
    embedding: createMockEmbedding(),
    mcp: createMockMcp(),
    sessionLock: new SessionLock(),
    systemPrompt: "You are helpful.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// recoverUnanswered
// ---------------------------------------------------------------------------

describe("recoverUnanswered", () => {
  it("processes unanswered messages from RPC in chronological order", async () => {
    const processedOrder: string[] = [];
    const insertFn = vi.fn(async (row: { session_id: string }) => {
      processedOrder.push(row.session_id);
      return { error: null };
    });

    // Two sessions have unanswered messages, returned in chronological order
    const supabase = createMockSupabase({
      rpcResult: {
        data: [
          {
            session_id: "sess-1",
            user_id: "user-1",
            created_at: "2026-03-01T10:00:00Z",
          },
          {
            session_id: "sess-2",
            user_id: "user-1",
            created_at: "2026-03-01T10:05:00Z",
          },
        ],
        error: null,
      },
      // processMessage needs session history + session metadata
      messagesResult: {
        data: [{ role: "user", content: "hello" }],
        error: null,
      },
      sessionResult: {
        data: { title: "Test", user_id: "user-1" },
        error: null,
      },
      insertFn,
    });

    const llm = createMockLLM([
      { content: "Response 1", tool_calls: [], finish_reason: "stop" },
      { content: "Response 2", tool_calls: [], finish_reason: "stop" },
    ]);

    const deps = makeDeps({ supabase, llm });
    await recoverUnanswered(deps);

    // Verify RPC was called
    expect(supabase.rpc).toHaveBeenCalledWith("get_unanswered_messages");

    // Verify messages were processed in order (sess-1 before sess-2)
    expect(processedOrder).toEqual(["sess-1", "sess-2"]);

    // Verify LLM was called twice (once per unanswered message)
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it("skips recovery when no unanswered messages exist", async () => {
    const supabase = createMockSupabase({
      rpcResult: { data: [], error: null },
    });
    const llm = createMockLLM([]);
    const deps = makeDeps({ supabase, llm });

    await recoverUnanswered(deps);

    expect(supabase.rpc).toHaveBeenCalledWith("get_unanswered_messages");
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("falls back to manual query when RPC fails", async () => {
    const insertFn = vi.fn(async () => ({ error: null }));

    const supabase = createMockSupabase({
      rpcResult: { data: null, error: { message: "function not found" } },
      // Fallback query returns messages ordered by created_at desc
      messagesResult: {
        data: [
          {
            session_id: "sess-A",
            role: "user",
            created_at: "2026-03-01T12:00:00Z",
          },
          {
            session_id: "sess-B",
            role: "assistant",
            created_at: "2026-03-01T11:00:00Z",
          },
          {
            session_id: "sess-B",
            role: "user",
            created_at: "2026-03-01T10:00:00Z",
          },
        ],
        error: null,
      },
      sessionResult: { data: { user_id: "user-1" }, error: null },
      insertFn,
    });

    const llm = createMockLLM([
      { content: "Recovered!", tool_calls: [], finish_reason: "stop" },
    ]);

    const deps = makeDeps({ supabase, llm });
    await recoverUnanswered(deps);

    // Only sess-A should be processed (sess-B latest is assistant)
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: "sess-A", role: "assistant" })
    );
  });
});

// ---------------------------------------------------------------------------
// handleUserMessage — retry + error handling
// ---------------------------------------------------------------------------

describe("handleUserMessage", () => {
  it("inserts assistant response on success", async () => {
    const insertFn = vi.fn(async () => ({ error: null }));
    const supabase = createMockSupabase({
      messagesResult: { data: [{ role: "user", content: "hi" }], error: null },
      sessionResult: { data: { title: null }, error: null },
      insertFn,
    });

    const deps = makeDeps({
      supabase,
      llm: createMockLLM([
        { content: "Hello!", tool_calls: [], finish_reason: "stop" },
      ]),
    });

    await handleUserMessage(deps, "sess-1", "user-1");

    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "sess-1",
        role: "assistant",
        content: "Hello!",
      })
    );
  });

  it("retries once on failure then succeeds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let callCount = 0;
    const llm: LLMProvider = {
      chat: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error("Transient failure");
        return {
          content: "Recovered!",
          tool_calls: [],
          finish_reason: "stop" as const,
        };
      }),
    };

    const insertFn = vi.fn(async () => ({ error: null }));
    const supabase = createMockSupabase({
      messagesResult: { data: [{ role: "user", content: "hi" }], error: null },
      sessionResult: { data: { title: null }, error: null },
      insertFn,
    });

    const deps = makeDeps({ supabase, llm });
    await handleUserMessage(deps, "sess-1", "user-1");

    // LLM called twice (first fails, retry succeeds)
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Recovered!" })
    );
  });

  it("writes error message after retry exhaustion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const llm: LLMProvider = {
      chat: vi.fn(async () => {
        throw new Error("Persistent failure");
      }),
    };

    const insertFn = vi.fn(async () => ({ error: null }));
    const supabase = createMockSupabase({
      messagesResult: { data: [{ role: "user", content: "hi" }], error: null },
      sessionResult: { data: { title: null }, error: null },
      insertFn,
    });

    const deps = makeDeps({ supabase, llm });
    await handleUserMessage(deps, "sess-1", "user-1");

    // LLM called twice (both fail)
    expect(llm.chat).toHaveBeenCalledTimes(2);

    // Error message inserted
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "sess-1",
        role: "assistant",
        content: expect.stringContaining("error"),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// System prompt includes current date
// ---------------------------------------------------------------------------

describe("processChat injects current date into system prompt", () => {
  it("includes the current date and time in the system prompt sent to the LLM", async () => {
    const llm = createMockLLM([
      { content: "Hello!", tool_calls: [], finish_reason: "stop" },
    ]);

    const insertFn = vi.fn(async () => ({ error: null }));
    const supabase = createMockSupabase({
      messagesResult: {
        data: [{ role: "user", content: "remind me next week" }],
        error: null,
      },
      sessionResult: { data: { title: null }, error: null },
      insertFn,
    });

    const deps = makeDeps({ supabase, llm, systemPrompt: "You are helpful." });
    await handleUserMessage(deps, "sess-1", "user-1");

    // The system prompt (first argument's first message) should contain the current date
    const chatCall = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const systemPrompt: string = chatCall[0][0].content;

    expect(systemPrompt).toMatch(/## Current date and time/);
    // Should contain an ISO-like date string for today
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    expect(systemPrompt).toContain(today);
  });
});

// ---------------------------------------------------------------------------
// Health check server
// ---------------------------------------------------------------------------

describe("startHealthServer", () => {
  let server: Server;

  afterEach(() => {
    server?.close();
  });

  it("returns 200 with status ok", async () => {
    // Use port 0 to get a random available port
    server = startHealthServer(0);

    // Wait for server to start listening
    await new Promise<void>((resolve) => {
      server.once("listening", resolve);
    });

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});
