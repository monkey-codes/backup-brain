import { describe, it, expect, vi } from "vitest";
import { ReactLoopExecutor } from "../react-loop-executor.js";
import type {
  LLMProvider,
  LLMResponse,
  EmbeddingProvider,
  ToolDefinition,
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
  results: Record<string, string> = {}
): ToolExecutor {
  return {
    listTools: vi.fn(async () => []),
    callTool: vi.fn(async (name: string) => results[name] ?? "{}"),
  };
}

function createMockEmbedding(): EmbeddingProvider {
  const fakeEmbedding = new Array(1536).fill(0.1);
  return {
    embed: vi.fn(async () => fakeEmbedding),
  };
}

const TOOLS: ToolDefinition[] = [
  {
    name: "capture_thought",
    description: "Create a thought with its decisions atomically",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        embedding: { type: "array", items: { type: "number" } },
        session_id: { type: "string" },
        created_by: { type: "string" },
        decisions: { type: "array" },
      },
    },
  },
  {
    name: "search_thoughts",
    description: "Search for past thoughts by semantic similarity",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        include_decisions: { type: "boolean" },
        match_threshold: { type: "number" },
        match_count: { type: "number" },
      },
    },
  },
  {
    name: "update_decision",
    description: "Update an existing decision",
    parameters: {
      type: "object",
      properties: {
        decision_id: { type: "string" },
        value: { type: "object" },
        corrected_value: { type: "object" },
        review_status: { type: "string" },
        corrected_by: { type: "string" },
      },
    },
  },
];

const SESSION_ID = "sess-1";
const USER_ID = "user-1";

function createExecutorAndRun(
  llm: LLMProvider,
  toolExecutor: ToolExecutor,
  messages?: { role: "user" | "assistant"; content: string }[]
) {
  const embedding = createMockEmbedding();
  const executor = new ReactLoopExecutor(llm, embedding, toolExecutor);
  return executor.run({
    systemPrompt: "You are helpful.",
    messages: messages ?? [{ role: "user", content: "test" }],
    tools: TOOLS,
    argInjections: {
      capture_thought: (args) => {
        args.session_id = SESSION_ID;
        args.created_by = USER_ID;
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests — Todo completion
// ---------------------------------------------------------------------------

describe("Todo completion", () => {
  it("completes a todo via search_thoughts + update_decision value merge", async () => {
    // Simulate: user says "I painted the fence"
    // Agent: 1) search_thoughts to find matching todo, 2) update_decision with completed_at
    const searchResult = [
      {
        id: "thought-1",
        content: "Paint the fence",
        decisions: [
          {
            id: "dec-todo-1",
            thought_id: "thought-1",
            decision_type: "todo",
            value: { description: "Paint the fence", completed_at: null },
            confidence: 0.95,
            reasoning: "User explicitly requested a todo",
            review_status: "pending",
          },
        ],
      },
    ];

    const llm = createMockLLM([
      // Round 1: Agent searches for matching todo
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "search_thoughts",
            arguments: JSON.stringify({
              query: "paint the fence",
              include_decisions: true,
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      // Round 2: Agent updates the todo with completed_at
      {
        content: null,
        tool_calls: [
          {
            id: "call_2",
            name: "update_decision",
            arguments: JSON.stringify({
              decision_id: "dec-todo-1",
              value: { completed_at: "2026-04-03T14:30:00Z" },
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      // Round 3: Final response
      {
        content:
          "Great job! I've marked your todo to paint the fence as complete.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      search_thoughts: JSON.stringify(searchResult),
      update_decision: JSON.stringify({ id: "dec-todo-1", success: true }),
    });

    const result = await createExecutorAndRun(llm, toolExecutor, [
      { role: "user", content: "I painted the fence" },
    ]);

    expect(result.content).toContain("paint the fence");

    // Verify search_thoughts was called with include_decisions: true
    const calls = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls;
    const searchCall = calls.find((c: unknown[]) => c[0] === "search_thoughts");
    expect(searchCall).toBeDefined();
    expect(searchCall![1].include_decisions).toBe(true);

    // Verify update_decision was called with value merge (not corrected_value)
    const updateCall = calls.find((c: unknown[]) => c[0] === "update_decision");
    expect(updateCall).toBeDefined();
    expect(updateCall![1].decision_id).toBe("dec-todo-1");
    expect(updateCall![1].value.completed_at).toBeTruthy();
    // Should NOT use corrected_value — completion is a user update, not a correction
    expect(updateCall![1].corrected_value).toBeUndefined();
    expect(updateCall![1].review_status).toBeUndefined();
  });

  it("does not change review_status when completing a todo", async () => {
    // Completion is a legitimate state transition, not a correction.
    // review_status should remain unchanged.
    const searchResult = [
      {
        id: "thought-2",
        content: "Buy groceries for the week",
        decisions: [
          {
            id: "dec-todo-2",
            thought_id: "thought-2",
            decision_type: "todo",
            value: {
              description: "Buy groceries for the week",
              completed_at: null,
            },
            confidence: 0.92,
            reasoning: "User stated a concrete task",
            review_status: "accepted",
          },
        ],
      },
    ];

    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "search_thoughts",
            arguments: JSON.stringify({
              query: "buy groceries",
              include_decisions: true,
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: null,
        tool_calls: [
          {
            id: "call_2",
            name: "update_decision",
            arguments: JSON.stringify({
              decision_id: "dec-todo-2",
              value: { completed_at: "2026-04-03T16:00:00Z" },
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "Done! I've marked the grocery shopping todo as complete.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      search_thoughts: JSON.stringify(searchResult),
      update_decision: JSON.stringify({ id: "dec-todo-2", success: true }),
    });

    await createExecutorAndRun(llm, toolExecutor, [
      { role: "user", content: "I bought the groceries" },
    ]);

    const calls = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls;
    const updateCall = calls.find((c: unknown[]) => c[0] === "update_decision");
    expect(updateCall).toBeDefined();
    // Must NOT set review_status — completion is not a correction
    expect(updateCall![1].review_status).toBeUndefined();
    expect(updateCall![1].corrected_value).toBeUndefined();
    // Must set completed_at via value merge
    expect(updateCall![1].value).toBeDefined();
    expect(updateCall![1].value.completed_at).toBeTruthy();
  });
});
