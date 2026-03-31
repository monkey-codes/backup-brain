import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SupabaseChatContextLoader,
  type ChatContextLoader,
} from "../chat-context-loader.js";
import type { ToolExecutor } from "../mcp-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSupabase(config: {
  messagesResult?: { data: unknown; error: unknown };
  sessionResult?: { data: unknown; error: unknown };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
  return {
    from: vi.fn((table: string) => {
      if (table === "chat_messages") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(
                () => config.messagesResult ?? { data: [], error: null }
              ),
            })),
          })),
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
      return { select: vi.fn() };
    }),
  };
}

function createMockToolExecutor(
  results: Record<string, string> = {}
): ToolExecutor {
  return {
    listTools: vi.fn(async () => []),
    callTool: vi.fn(async (name: string) => results[name] ?? "[]"),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SupabaseChatContextLoader", () => {
  describe("loadHistory", () => {
    it("returns messages in chronological order", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "What's up?" },
      ];

      const supabase = createMockSupabase({
        messagesResult: { data: messages, error: null },
      });

      const loader = new SupabaseChatContextLoader(
        supabase,
        createMockToolExecutor()
      );
      const result = await loader.loadHistory("sess-1");

      expect(result).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "What's up?" },
      ]);
    });

    it("returns empty array when no messages exist", async () => {
      const supabase = createMockSupabase({
        messagesResult: { data: [], error: null },
      });

      const loader = new SupabaseChatContextLoader(
        supabase,
        createMockToolExecutor()
      );
      const result = await loader.loadHistory("sess-1");

      expect(result).toEqual([]);
    });

    it("returns empty array on error", async () => {
      const supabase = createMockSupabase({
        messagesResult: { data: null, error: { message: "query failed" } },
      });

      const loader = new SupabaseChatContextLoader(
        supabase,
        createMockToolExecutor()
      );
      const result = await loader.loadHistory("sess-1");

      expect(result).toEqual([]);
    });
  });

  describe("loadSessionTitle", () => {
    it("returns the session title", async () => {
      const supabase = createMockSupabase({
        sessionResult: { data: { title: "My Chat" }, error: null },
      });

      const loader = new SupabaseChatContextLoader(
        supabase,
        createMockToolExecutor()
      );
      const result = await loader.loadSessionTitle("sess-1");

      expect(result).toBe("My Chat");
    });

    it("returns null when session has no title", async () => {
      const supabase = createMockSupabase({
        sessionResult: { data: { title: null }, error: null },
      });

      const loader = new SupabaseChatContextLoader(
        supabase,
        createMockToolExecutor()
      );
      const result = await loader.loadSessionTitle("sess-1");

      expect(result).toBeNull();
    });

    it("returns null on error", async () => {
      const supabase = createMockSupabase({
        sessionResult: { data: null, error: { message: "not found" } },
      });

      const loader = new SupabaseChatContextLoader(
        supabase,
        createMockToolExecutor()
      );
      const result = await loader.loadSessionTitle("sess-1");

      expect(result).toBeNull();
    });
  });

  describe("loadCorrections", () => {
    it("returns parsed corrections", async () => {
      const corrections = [
        {
          id: "d-1",
          decision_type: "classification",
          value: { category: "Business Ideas" },
          corrected_value: { category: "Home Maintenance" },
          reasoning: "Seemed like a business idea",
          review_status: "corrected",
        },
      ];

      const toolExecutor = createMockToolExecutor({
        list_decisions: JSON.stringify(corrections),
      });

      const supabase = createMockSupabase({});
      const loader = new SupabaseChatContextLoader(supabase, toolExecutor);
      const result = await loader.loadCorrections();

      expect(result).toEqual(corrections);
      expect(toolExecutor.callTool).toHaveBeenCalledWith("list_decisions", {
        review_status: "corrected",
        limit: 50,
      });
    });

    it("returns empty array when no corrections exist", async () => {
      const toolExecutor = createMockToolExecutor({
        list_decisions: "[]",
      });

      const supabase = createMockSupabase({});
      const loader = new SupabaseChatContextLoader(supabase, toolExecutor);
      const result = await loader.loadCorrections();

      expect(result).toEqual([]);
    });

    it("returns empty array on MCP failure", async () => {
      const toolExecutor = createMockToolExecutor();
      (toolExecutor.callTool as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("MCP unavailable")
      );

      const supabase = createMockSupabase({});
      const loader = new SupabaseChatContextLoader(supabase, toolExecutor);
      const result = await loader.loadCorrections();

      expect(result).toEqual([]);
    });

    it("returns empty array on parse failure", async () => {
      const toolExecutor = createMockToolExecutor({
        list_decisions: "not json",
      });

      const supabase = createMockSupabase({});
      const loader = new SupabaseChatContextLoader(supabase, toolExecutor);
      const result = await loader.loadCorrections();

      expect(result).toEqual([]);
    });
  });
});
