import { describe, it, expect, vi, beforeEach } from "vitest";
import { processMessage, type ProcessContext } from "../react-loop.js";
import type { LLMProvider, LLMResponse, LLMMessage, ToolDefinition } from "../llm-provider.js";
import type { McpClient } from "../mcp-client.js";

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

function createMockMcp(results: Record<string, string>): McpClient {
  return {
    callTool: vi.fn(async (name: string) => results[name] ?? "{}"),
    listTools: vi.fn(async () => []),
    initialize: vi.fn(async () => {}),
  } as unknown as McpClient;
}

function createMockSupabase(messages: { role: string; content: string }[]) {
  return {
    from: vi.fn((table: string) => {
      if (table === "chat_messages") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                data: messages,
                error: null,
              })),
            })),
          })),
        };
      }
      return { select: vi.fn() };
    }),
  } as unknown as ProcessContext["supabase"];
}

const TOOLS: ToolDefinition[] = [
  {
    name: "capture_thought",
    description: "Create a thought",
    parameters: { type: "object", properties: { content: { type: "string" } } },
  },
  {
    name: "set_session_title",
    description: "Set session title",
    parameters: { type: "object", properties: { title: { type: "string" } } },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processMessage (ReAct loop)", () => {
  it("returns a direct response when LLM doesn't call tools", async () => {
    const llm = createMockLLM([
      { content: "Hello! How can I help?", tool_calls: [], finish_reason: "stop" },
    ]);
    const mcp = createMockMcp({});
    const supabase = createMockSupabase([{ role: "user", content: "Hi" }]);

    const result = await processMessage({
      sessionId: "sess-1",
      userId: "user-1",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "You are helpful.",
      supabase,
    });

    expect(result).toBe("Hello! How can I help?");
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it("executes tool calls and returns final response", async () => {
    const llm = createMockLLM([
      // First call: LLM wants to call capture_thought
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: JSON.stringify({ content: "User wants to fix the roof" }),
          },
        ],
        finish_reason: "tool_calls",
      },
      // Second call: LLM produces final response
      {
        content: "Got it! I've captured your thought about fixing the roof.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const mcp = createMockMcp({
      capture_thought: JSON.stringify({ thought_id: "t-1", decisions: [] }),
    });

    const supabase = createMockSupabase([
      { role: "user", content: "I need to fix the roof" },
    ]);

    const result = await processMessage({
      sessionId: "sess-1",
      userId: "user-1",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "You are helpful.",
      supabase,
    });

    expect(result).toBe("Got it! I've captured your thought about fixing the roof.");
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(mcp.callTool).toHaveBeenCalledWith("capture_thought", {
      content: "User wants to fix the roof",
      session_id: "sess-1",
      created_by: "user-1",
    });
  });

  it("handles multiple tool calls in sequence", async () => {
    const llm = createMockLLM([
      // Round 1: capture_thought + set_session_title
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: JSON.stringify({ content: "Fix roof" }),
          },
          {
            id: "call_2",
            name: "set_session_title",
            arguments: JSON.stringify({
              session_id: "sess-1",
              title: "Home Maintenance",
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      // Round 2: final response
      {
        content: "All done!",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const mcp = createMockMcp({
      capture_thought: JSON.stringify({ thought_id: "t-1" }),
      set_session_title: JSON.stringify({ id: "sess-1", title: "Home Maintenance" }),
    });

    const supabase = createMockSupabase([
      { role: "user", content: "I need to fix the roof" },
    ]);

    const result = await processMessage({
      sessionId: "sess-1",
      userId: "user-1",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "You are helpful.",
      supabase,
    });

    expect(result).toBe("All done!");
    expect(mcp.callTool).toHaveBeenCalledTimes(2);
  });

  it("handles tool errors gracefully", async () => {
    const mcp = createMockMcp({});
    (mcp.callTool as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Tool failed"),
    );

    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          { id: "call_1", name: "capture_thought", arguments: '{"content":"x"}' },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "Sorry, there was an issue saving that.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const supabase = createMockSupabase([{ role: "user", content: "test" }]);

    const result = await processMessage({
      sessionId: "sess-1",
      userId: "user-1",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "You are helpful.",
      supabase,
    });

    expect(result).toBe("Sorry, there was an issue saving that.");

    // Verify error was passed back to LLM
    const secondCallMessages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[1][0];
    const toolResultMsg = secondCallMessages.find(
      (m: LLMMessage) => m.role === "tool",
    );
    expect(toolResultMsg.content).toContain("Tool failed");
  });

  it("injects session_id and created_by into capture_thought", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: JSON.stringify({
              content: "test",
              embedding: [],
              decisions: [],
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "Done", tool_calls: [], finish_reason: "stop" },
    ]);

    const mcp = createMockMcp({
      capture_thought: JSON.stringify({ thought_id: "t-1" }),
    });

    const supabase = createMockSupabase([{ role: "user", content: "test" }]);

    await processMessage({
      sessionId: "sess-abc",
      userId: "user-xyz",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "test",
      supabase,
    });

    expect(mcp.callTool).toHaveBeenCalledWith(
      "capture_thought",
      expect.objectContaining({
        session_id: "sess-abc",
        created_by: "user-xyz",
      }),
    );
  });

  it("guards against infinite tool loops", async () => {
    // LLM always wants to call tools — should hit the 10-round limit
    const toolResponse: LLMResponse = {
      content: null,
      tool_calls: [
        { id: "call_x", name: "list_thoughts", arguments: "{}" },
      ],
      finish_reason: "tool_calls",
    };

    const llm = createMockLLM(Array(11).fill(toolResponse));
    const mcp = createMockMcp({ list_thoughts: "[]" });
    const supabase = createMockSupabase([{ role: "user", content: "test" }]);

    const result = await processMessage({
      sessionId: "sess-1",
      userId: "user-1",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "test",
      supabase,
    });

    expect(result).toContain("stuck in a processing loop");
    expect(llm.chat).toHaveBeenCalledTimes(10);
  });
});
