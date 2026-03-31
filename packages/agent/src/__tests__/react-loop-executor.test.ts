import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ReactLoopExecutor,
  type ReactLoopParams,
} from "../react-loop-executor.js";
import type {
  LLMProvider,
  LLMResponse,
  LLMMessage,
  ToolDefinition,
  EmbeddingProvider,
} from "../llm-provider.js";
import type { ToolExecutor } from "../mcp-client.js";

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

function createMockToolExecutor(
  results: Record<string, string> = {},
  tools: ToolDefinition[] = []
): ToolExecutor {
  return {
    listTools: vi.fn(async () => tools),
    callTool: vi.fn(async (name: string) => results[name] ?? '{"ok": true}'),
  };
}

function createMockEmbedding(): EmbeddingProvider {
  return {
    embed: vi.fn(async () => new Array(1536).fill(0.1)),
  };
}

const BASE_TOOLS: ToolDefinition[] = [
  {
    name: "capture_thought",
    description: "Create a thought",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        embedding: { type: "array", items: { type: "number" } },
        session_id: { type: "string" },
        created_by: { type: "string" },
      },
    },
  },
  {
    name: "search_thoughts",
    description: "Search thoughts by embedding",
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
    name: "set_session_title",
    description: "Set session title",
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        title: { type: "string" },
      },
    },
  },
  {
    name: "list_thoughts",
    description: "List thoughts",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "update_decision",
    description: "Update a decision",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_group",
    description: "Create a group",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_notification",
    description: "Create a notification",
    parameters: { type: "object", properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReactLoopExecutor", () => {
  let embedding: EmbeddingProvider;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    embedding = createMockEmbedding();
    toolExecutor = createMockToolExecutor({}, BASE_TOOLS);
  });

  it("returns a direct response when LLM finishes without tool calls", async () => {
    const llm = createMockLLM([
      { content: "Hello!", tool_calls: [], finish_reason: "stop" },
    ]);

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    const result = await executor.run({
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
      tools: BASE_TOOLS,
    });

    expect(result.content).toBe("Hello!");
    expect(result.rounds).toBe(1);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it("executes a single tool round and returns the final response", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "list_thoughts",
            arguments: "{}",
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "Here are your thoughts.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    toolExecutor = createMockToolExecutor(
      { list_thoughts: '[{"id": "t-1"}]' },
      BASE_TOOLS
    );

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    const result = await executor.run({
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: "Show me my thoughts" }],
      tools: BASE_TOOLS,
    });

    expect(result.content).toBe("Here are your thoughts.");
    expect(result.rounds).toBe(2);
    expect(toolExecutor.callTool).toHaveBeenCalledWith(
      "list_thoughts",
      expect.any(Object)
    );
  });

  it("injects embedding for search_thoughts (query → vector)", async () => {
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
        content: "Found some thoughts.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    toolExecutor = createMockToolExecutor(
      { search_thoughts: "[]" },
      BASE_TOOLS
    );

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "search" }],
      tools: BASE_TOOLS,
    });

    expect(embedding.embed).toHaveBeenCalledWith("car maintenance");
    expect(toolExecutor.callTool).toHaveBeenCalledWith(
      "search_thoughts",
      expect.objectContaining({
        embedding: expect.any(Array),
      })
    );
    // query param should be removed
    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(callArgs.query).toBeUndefined();
  });

  it("injects embedding for capture_thought (content → vector)", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: JSON.stringify({
              content: "Fix the roof",
              decisions: [],
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "Captured!", tool_calls: [], finish_reason: "stop" },
    ]);

    toolExecutor = createMockToolExecutor(
      { capture_thought: '{"thought_id": "t-1"}' },
      BASE_TOOLS
    );

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "remember this" }],
      tools: BASE_TOOLS,
    });

    expect(embedding.embed).toHaveBeenCalledWith("Fix the roof");
    expect(toolExecutor.callTool).toHaveBeenCalledWith(
      "capture_thought",
      expect.objectContaining({
        content: "Fix the roof",
        embedding: expect.any(Array),
      })
    );
  });

  it("applies caller-provided argInjections after built-in injections", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: JSON.stringify({
              content: "Test thought",
              decisions: [],
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "Done", tool_calls: [], finish_reason: "stop" },
    ]);

    toolExecutor = createMockToolExecutor(
      { capture_thought: '{"thought_id": "t-1"}' },
      BASE_TOOLS
    );

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: BASE_TOOLS,
      argInjections: {
        capture_thought: (args) => {
          args.session_id = "sess-123";
          args.created_by = "user-abc";
        },
      },
    });

    expect(toolExecutor.callTool).toHaveBeenCalledWith(
      "capture_thought",
      expect.objectContaining({
        session_id: "sess-123",
        created_by: "user-abc",
        embedding: expect.any(Array), // built-in injection still ran
      })
    );
  });

  it("applies argInjections to set_session_title", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "set_session_title",
            arguments: JSON.stringify({ title: "My Chat" }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "Done", tool_calls: [], finish_reason: "stop" },
    ]);

    toolExecutor = createMockToolExecutor(
      { set_session_title: '{"ok": true}' },
      BASE_TOOLS
    );

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: BASE_TOOLS,
      argInjections: {
        set_session_title: (args) => {
          args.session_id = "sess-456";
        },
      },
    });

    expect(toolExecutor.callTool).toHaveBeenCalledWith(
      "set_session_title",
      expect.objectContaining({
        session_id: "sess-456",
        title: "My Chat",
      })
    );
  });

  it("filters tools by toolFilter set", async () => {
    const llm = createMockLLM([
      { content: "Done.", tool_calls: [], finish_reason: "stop" },
    ]);

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: BASE_TOOLS,
      toolFilter: new Set([
        "update_decision",
        "create_group",
        "search_thoughts",
      ]),
    });

    // Verify the LLM only saw filtered tools
    const toolsArg = (llm.chat as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as ToolDefinition[];
    const toolNames = toolsArg.map((t) => t.name);
    expect(toolNames).toContain("update_decision");
    expect(toolNames).toContain("create_group");
    expect(toolNames).toContain("search_thoughts");
    expect(toolNames).not.toContain("capture_thought");
    expect(toolNames).not.toContain("list_thoughts");
    expect(toolNames).not.toContain("set_session_title");
  });

  it("rewrites tool schemas: search_thoughts gets query param, capture_thought hides internals", async () => {
    const llm = createMockLLM([
      { content: "OK", tool_calls: [], finish_reason: "stop" },
    ]);

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: BASE_TOOLS,
    });

    const toolsArg = (llm.chat as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as ToolDefinition[];

    // search_thoughts should have query, not embedding
    const searchTool = toolsArg.find((t) => t.name === "search_thoughts")!;
    const searchProps = (searchTool.parameters as Record<string, unknown>)
      .properties as Record<string, unknown>;
    expect(searchProps.query).toBeDefined();
    expect(searchProps.embedding).toBeUndefined();

    // capture_thought should hide embedding, session_id, created_by
    const captureTool = toolsArg.find((t) => t.name === "capture_thought")!;
    const captureProps = (captureTool.parameters as Record<string, unknown>)
      .properties as Record<string, unknown>;
    expect(captureProps.content).toBeDefined();
    expect(captureProps.decisions).toBeDefined();
    expect(captureProps.embedding).toBeUndefined();
    expect(captureProps.session_id).toBeUndefined();
    expect(captureProps.created_by).toBeUndefined();

    // set_session_title should hide session_id
    const titleTool = toolsArg.find((t) => t.name === "set_session_title")!;
    const titleProps = (titleTool.parameters as Record<string, unknown>)
      .properties as Record<string, unknown>;
    expect(titleProps.title).toBeDefined();
    expect(titleProps.session_id).toBeUndefined();
  });

  it("serializes tool errors to JSON and passes back to LLM", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "list_thoughts",
            arguments: "{}",
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "Sorry, there was an issue.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    toolExecutor = createMockToolExecutor({}, BASE_TOOLS);
    (toolExecutor.callTool as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("MCP server down")
    );

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    const result = await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: BASE_TOOLS,
    });

    expect(result.content).toBe("Sorry, there was an issue.");

    // Verify error was passed to LLM as tool result
    const secondCallMessages = (llm.chat as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as LLMMessage[];
    const toolResultMsg = secondCallMessages.find((m) => m.role === "tool");
    expect(toolResultMsg!.content).toContain("MCP server down");
  });

  it("terminates after max rounds with fallback message", async () => {
    const toolResponse: LLMResponse = {
      content: null,
      tool_calls: [{ id: "call_x", name: "list_thoughts", arguments: "{}" }],
      finish_reason: "tool_calls",
    };

    const llm = createMockLLM(Array(11).fill(toolResponse));
    toolExecutor = createMockToolExecutor({ list_thoughts: "[]" }, BASE_TOOLS);

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    const result = await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: BASE_TOOLS,
    });

    expect(result.content).toContain("stuck in a processing loop");
    expect(result.rounds).toBe(10);
    expect(llm.chat).toHaveBeenCalledTimes(10);
  });

  it("respects custom maxRounds", async () => {
    const toolResponse: LLMResponse = {
      content: null,
      tool_calls: [{ id: "call_x", name: "list_thoughts", arguments: "{}" }],
      finish_reason: "tool_calls",
    };

    const llm = createMockLLM(Array(5).fill(toolResponse));
    toolExecutor = createMockToolExecutor({ list_thoughts: "[]" }, BASE_TOOLS);

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    const result = await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: BASE_TOOLS,
      maxRounds: 3,
    });

    expect(result.content).toContain("stuck in a processing loop");
    expect(result.rounds).toBe(3);
    expect(llm.chat).toHaveBeenCalledTimes(3);
  });

  it("dispatches multiple tool calls in a single round", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "list_thoughts",
            arguments: "{}",
          },
          {
            id: "call_2",
            name: "update_decision",
            arguments: JSON.stringify({ decision_id: "d-1" }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "All done!", tool_calls: [], finish_reason: "stop" },
    ]);

    toolExecutor = createMockToolExecutor(
      { list_thoughts: "[]", update_decision: '{"ok": true}' },
      BASE_TOOLS
    );

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    const result = await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: BASE_TOOLS,
    });

    expect(result.content).toBe("All done!");
    expect(toolExecutor.callTool).toHaveBeenCalledTimes(2);
    expect(toolExecutor.callTool).toHaveBeenCalledWith(
      "list_thoughts",
      expect.any(Object)
    );
    expect(toolExecutor.callTool).toHaveBeenCalledWith(
      "update_decision",
      expect.objectContaining({ decision_id: "d-1" })
    );
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
      { content: "Found.", tool_calls: [], finish_reason: "stop" },
    ]);

    toolExecutor = createMockToolExecutor(
      { search_thoughts: "[]" },
      BASE_TOOLS
    );

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: BASE_TOOLS,
    });

    expect(toolExecutor.callTool).toHaveBeenCalledWith(
      "search_thoughts",
      expect.objectContaining({
        embedding: expect.any(Array),
        match_threshold: 0.7,
        match_count: 5,
      })
    );
  });

  it("returns empty string when LLM stops with null content", async () => {
    const llm = createMockLLM([
      { content: null, tool_calls: [], finish_reason: "stop" },
    ]);

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    const result = await executor.run({
      systemPrompt: "test",
      messages: [{ role: "user", content: "test" }],
      tools: BASE_TOOLS,
    });

    expect(result.content).toBe("");
  });

  it("includes system prompt as first message to LLM", async () => {
    const llm = createMockLLM([
      { content: "OK", tool_calls: [], finish_reason: "stop" },
    ]);

    const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
    await executor.run({
      systemPrompt: "You are a helpful brain assistant.",
      messages: [{ role: "user", content: "Hi" }],
      tools: BASE_TOOLS,
    });

    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as LLMMessage[];
    expect(messages[0]).toEqual({
      role: "system",
      content: "You are a helpful brain assistant.",
    });
    expect(messages[1]).toEqual({ role: "user", content: "Hi" });
  });
});
