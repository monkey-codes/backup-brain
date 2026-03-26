import { describe, it, expect, vi, beforeEach } from "vitest";
import { processMessage, rewriteToolsForLLM, type ProcessContext } from "../react-loop.js";
import type { LLMProvider, LLMResponse, LLMMessage, ToolDefinition, EmbeddingProvider } from "../llm-provider.js";
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

function createMockSupabase(
  messages: { role: string; content: string }[],
  sessionTitle: string | null = null,
) {
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
      if (table === "chat_sessions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({
                data: { title: sessionTitle },
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

function createMockEmbedding(): EmbeddingProvider {
  return {
    embed: vi.fn(async () => new Array(1536).fill(0.1)),
  };
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
      embedding: createMockEmbedding(),
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
      embedding: createMockEmbedding(),
    });

    expect(result).toBe("Got it! I've captured your thought about fixing the roof.");
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(mcp.callTool).toHaveBeenCalledWith(
      "capture_thought",
      expect.objectContaining({
        content: "User wants to fix the roof",
        session_id: "sess-1",
        created_by: "user-1",
        embedding: expect.any(Array),
      }),
    );
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
      embedding: createMockEmbedding(),
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
      embedding: createMockEmbedding(),
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
      embedding: createMockEmbedding(),
    });

    expect(mcp.callTool).toHaveBeenCalledWith(
      "capture_thought",
      expect.objectContaining({
        session_id: "sess-abc",
        created_by: "user-xyz",
      }),
    );
  });

  it("injects session_id into set_session_title", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "set_session_title",
            arguments: JSON.stringify({ title: "Roof repairs" }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "Done", tool_calls: [], finish_reason: "stop" },
    ]);

    const mcp = createMockMcp({
      set_session_title: JSON.stringify({ id: "sess-abc", title: "Roof repairs" }),
    });

    const supabase = createMockSupabase([{ role: "user", content: "Fix the roof" }]);

    await processMessage({
      sessionId: "sess-abc",
      userId: "user-1",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "test",
      supabase,
      embedding: createMockEmbedding(),
    });

    expect(mcp.callTool).toHaveBeenCalledWith(
      "set_session_title",
      expect.objectContaining({
        session_id: "sess-abc",
        title: "Roof repairs",
      }),
    );
  });

  it("includes 'no title' context in system prompt when session has no title", async () => {
    const llm = createMockLLM([
      { content: "Hello!", tool_calls: [], finish_reason: "stop" },
    ]);
    const mcp = createMockMcp({});
    const supabase = createMockSupabase([{ role: "user", content: "Hi" }], null);

    await processMessage({
      sessionId: "sess-1",
      userId: "user-1",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "You are helpful.",
      supabase,
      embedding: createMockEmbedding(),
    });

    const systemMsg = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0][0];
    expect(systemMsg.content).toContain("Session title: (none)");
    expect(systemMsg.content).toContain("set_session_title");
  });

  it("includes existing title in system prompt and instructs not to re-set", async () => {
    const llm = createMockLLM([
      { content: "Hello!", tool_calls: [], finish_reason: "stop" },
    ]);
    const mcp = createMockMcp({});
    const supabase = createMockSupabase(
      [{ role: "user", content: "Hi" }],
      "Existing Title",
    );

    await processMessage({
      sessionId: "sess-1",
      userId: "user-1",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "You are helpful.",
      supabase,
      embedding: createMockEmbedding(),
    });

    const systemMsg = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0][0];
    expect(systemMsg.content).toContain('"Existing Title"');
    expect(systemMsg.content).toContain("do not call `set_session_title`");
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
      embedding: createMockEmbedding(),
    });

    expect(result).toContain("stuck in a processing loop");
    expect(llm.chat).toHaveBeenCalledTimes(10);
  });

  it("injects embedding for search_thoughts and removes query param", async () => {
    const embeddingProvider = createMockEmbedding();
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "search_thoughts",
            arguments: JSON.stringify({ query: "car maintenance" }),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "I found some thoughts about car maintenance.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const mcp = createMockMcp({
      search_thoughts: JSON.stringify([
        { id: "t-1", content: "Oil change due in March", similarity: 0.87 },
      ]),
    });

    const supabase = createMockSupabase([
      { role: "user", content: "What did I say about the car?" },
    ]);

    const result = await processMessage({
      sessionId: "sess-1",
      userId: "user-1",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "You are helpful.",
      supabase,
      embedding: embeddingProvider,
    });

    expect(result).toBe("I found some thoughts about car maintenance.");
    expect(embeddingProvider.embed).toHaveBeenCalledWith("car maintenance");
    expect(mcp.callTool).toHaveBeenCalledWith(
      "search_thoughts",
      expect.objectContaining({
        embedding: expect.any(Array),
      }),
    );
    // query param should be removed before calling MCP
    const callArgs = (mcp.callTool as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.query).toBeUndefined();
  });

  it("passes through match_threshold and match_count for search_thoughts", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "search_thoughts",
            arguments: JSON.stringify({
              query: "business ideas",
              match_threshold: 0.7,
              match_count: 5,
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "Here's what I found.", tool_calls: [], finish_reason: "stop" },
    ]);

    const mcp = createMockMcp({ search_thoughts: "[]" });
    const supabase = createMockSupabase([{ role: "user", content: "test" }]);

    await processMessage({
      sessionId: "sess-1",
      userId: "user-1",
      llm,
      mcp,
      tools: TOOLS,
      systemPrompt: "test",
      supabase,
      embedding: createMockEmbedding(),
    });

    expect(mcp.callTool).toHaveBeenCalledWith(
      "search_thoughts",
      expect.objectContaining({
        embedding: expect.any(Array),
        match_threshold: 0.7,
        match_count: 5,
      }),
    );
  });
});

describe("rewriteToolsForLLM", () => {
  it("replaces search_thoughts embedding param with query param", () => {
    const mcpTools: ToolDefinition[] = [
      {
        name: "search_thoughts",
        description: "Search thoughts by semantic similarity using a pre-computed embedding vector.",
        parameters: {
          type: "object",
          properties: {
            embedding: { type: "array", items: { type: "number" } },
            match_threshold: { type: "number" },
            match_count: { type: "number" },
          },
          required: ["embedding"],
        },
      },
      {
        name: "capture_thought",
        description: "Create a thought",
        parameters: { type: "object", properties: { content: { type: "string" } } },
      },
    ];

    const rewritten = rewriteToolsForLLM(mcpTools);

    // search_thoughts should have query instead of embedding
    const searchTool = rewritten.find((t) => t.name === "search_thoughts")!;
    const props = (searchTool.parameters as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props.query).toBeDefined();
    expect(props.embedding).toBeUndefined();
    expect(((searchTool.parameters as Record<string, unknown>).required as string[])).toContain("query");

    // Other tools should be unchanged
    const captureTool = rewritten.find((t) => t.name === "capture_thought")!;
    expect(captureTool).toEqual(mcpTools[1]);
  });
});
