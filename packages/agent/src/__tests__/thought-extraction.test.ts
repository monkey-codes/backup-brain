import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReactLoopExecutor } from "../react-loop-executor.js";
import type {
  LLMProvider,
  LLMResponse,
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
    name: "create_decision",
    description: "Add a decision to an existing thought",
    parameters: {
      type: "object",
      properties: {
        thought_id: { type: "string" },
        decision_type: { type: "string" },
        value: { type: "object" },
        confidence: { type: "number" },
        reasoning: { type: "string" },
      },
    },
  },
  {
    name: "set_session_title",
    description: "Set session title",
    parameters: {
      type: "object",
      properties: { session_id: { type: "string" }, title: { type: "string" } },
    },
  },
];

const SESSION_ID = "sess-1";
const USER_ID = "user-1";

function createExecutorAndRun(
  llm: LLMProvider,
  toolExecutor: ToolExecutor,
  embeddingProvider?: EmbeddingProvider,
  messages?: { role: "user" | "assistant"; content: string }[]
) {
  const embedding = embeddingProvider ?? createMockEmbedding();
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
      set_session_title: (args) => {
        args.session_id = SESSION_ID;
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests — Thought extraction, classification & tagging
// ---------------------------------------------------------------------------

describe("Thought extraction, classification & tagging", () => {
  it("captures a thought with classification, entity, and tag decisions", async () => {
    const captureArgs = {
      content: "Need to replace the gutters on the north side of the house",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Home Maintenance" },
          confidence: 0.95,
          reasoning: "User is discussing home repair work",
        },
        {
          decision_type: "entity",
          value: { name: "house", type: "thing" },
          confidence: 0.9,
          reasoning: "The house is the subject of the maintenance",
        },
        {
          decision_type: "tag",
          value: { label: "gutters" },
          confidence: 0.85,
          reasoning: "Gutters are the specific item being discussed",
        },
      ],
    };

    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: JSON.stringify(captureArgs),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content:
          "Got it! I've captured your thought about replacing the gutters.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({
        thought_id: "t-1",
        decisions: [
          {
            id: "d-1",
            decision_type: "classification",
            value: { category: "Home Maintenance" },
          },
          {
            id: "d-2",
            decision_type: "entity",
            value: { name: "house", type: "thing" },
          },
          { id: "d-3", decision_type: "tag", value: { label: "gutters" } },
        ],
      }),
    });

    const embeddingProvider = createMockEmbedding();

    const result = await createExecutorAndRun(
      llm,
      toolExecutor,
      embeddingProvider,
      [
        {
          role: "user",
          content:
            "I need to replace the gutters on the north side of the house",
        },
      ]
    );

    expect(result.content).toContain("gutters");

    // Verify capture_thought was called with correct decisions
    expect(toolExecutor.callTool).toHaveBeenCalledWith(
      "capture_thought",
      expect.objectContaining({
        content: captureArgs.content,
        session_id: SESSION_ID,
        created_by: USER_ID,
        embedding: expect.any(Array),
        decisions: captureArgs.decisions,
      })
    );

    // Verify embedding was generated from thought content
    expect(embeddingProvider.embed).toHaveBeenCalledWith(captureArgs.content);
  });

  it("handles multiple decisions with confidence scores and reasoning", async () => {
    const captureArgs = {
      content:
        "Meeting with John at the Denver office next Friday to discuss the bakery franchise idea",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Business Ideas" },
          confidence: 0.8,
          reasoning: "Discussion about a franchise business opportunity",
        },
        {
          decision_type: "entity",
          value: { name: "John", type: "person" },
          confidence: 0.95,
          reasoning: "John is a person mentioned in the meeting",
        },
        {
          decision_type: "entity",
          value: { name: "Denver office", type: "place" },
          confidence: 0.9,
          reasoning: "Denver office is the location of the meeting",
        },
        {
          decision_type: "entity",
          value: { name: "bakery franchise", type: "thing" },
          confidence: 0.85,
          reasoning: "The bakery franchise is the subject of discussion",
        },
        {
          decision_type: "tag",
          value: { label: "franchise" },
          confidence: 0.85,
          reasoning: "Franchise is a key topic",
        },
        {
          decision_type: "tag",
          value: { label: "meeting" },
          confidence: 0.9,
          reasoning: "This involves a scheduled meeting",
        },
        {
          decision_type: "reminder",
          value: {
            due_at: "2026-04-03T09:00:00Z",
            description:
              "Meeting with John at Denver office about bakery franchise",
          },
          confidence: 0.85,
          reasoning:
            "User mentioned a meeting next Friday which is time-sensitive",
        },
      ],
    };

    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: JSON.stringify(captureArgs),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "I've noted your meeting with John. I'll remind you about it!",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-2", decisions: [] }),
    });

    await createExecutorAndRun(llm, toolExecutor);

    // Verify all 7 decisions were passed through
    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    const passedDecisions = callArgs.decisions;
    expect(passedDecisions).toHaveLength(7);

    // Verify decision types
    const types = passedDecisions.map(
      (d: { decision_type: string }) => d.decision_type
    );
    expect(types.filter((t: string) => t === "classification")).toHaveLength(1);
    expect(types.filter((t: string) => t === "entity")).toHaveLength(3);
    expect(types.filter((t: string) => t === "tag")).toHaveLength(2);
    expect(types.filter((t: string) => t === "reminder")).toHaveLength(1);

    // Verify every decision has confidence and reasoning
    for (const decision of passedDecisions) {
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(decision.reasoning).toBeTruthy();
    }
  });

  it("supports create_decision for adding decisions to existing thoughts", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "create_decision",
            arguments: JSON.stringify({
              thought_id: "t-existing",
              decision_type: "tag",
              value: { label: "urgent" },
              confidence: 0.9,
              reasoning: "User indicated this is time-sensitive",
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "I've added an 'urgent' tag to that thought.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      create_decision: JSON.stringify({
        id: "d-new",
        decision_type: "tag",
        value: { label: "urgent" },
      }),
    });

    const result = await createExecutorAndRun(llm, toolExecutor, undefined, [
      { role: "user", content: "Actually that last thing is urgent" },
    ]);

    expect(result.content).toContain("urgent");
    expect(toolExecutor.callTool).toHaveBeenCalledWith("create_decision", {
      thought_id: "t-existing",
      decision_type: "tag",
      value: { label: "urgent" },
      confidence: 0.9,
      reasoning: "User indicated this is time-sensitive",
    });
  });

  it("supports agent-created categories beyond the seed set", async () => {
    const captureArgs = {
      content: "Try the new ramen place on Pearl Street — amazing tonkotsu",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Food & Dining" },
          confidence: 0.9,
          reasoning:
            "User is recommending a restaurant, which fits a food category",
        },
      ],
    };

    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: JSON.stringify(captureArgs),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "Noted! I'll remember that ramen recommendation.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-3", decisions: [] }),
    });

    await createExecutorAndRun(llm, toolExecutor);

    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    const classification = callArgs.decisions[0];
    expect(classification.decision_type).toBe("classification");
    expect(classification.value.category).toBe("Food & Dining");
  });

  it("generates embeddings for capture_thought but not other tools", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: JSON.stringify({
              content: "Buy new tires for the truck",
              decisions: [
                {
                  decision_type: "classification",
                  value: { category: "Vehicles" },
                  confidence: 0.95,
                  reasoning: "Truck maintenance is a vehicle topic",
                },
              ],
            }),
          },
          {
            id: "call_2",
            name: "set_session_title",
            arguments: JSON.stringify({ title: "Truck Tires" }),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "Got it!",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-4", decisions: [] }),
      set_session_title: JSON.stringify({ id: "sess-1" }),
    });

    const embeddingProvider = createMockEmbedding();

    await createExecutorAndRun(llm, toolExecutor, embeddingProvider);

    // Embedding generated once — only for capture_thought
    expect(embeddingProvider.embed).toHaveBeenCalledTimes(1);
    expect(embeddingProvider.embed).toHaveBeenCalledWith(
      "Buy new tires for the truck"
    );

    // capture_thought gets embedding injected
    const captureCall = (
      toolExecutor.callTool as ReturnType<typeof vi.fn>
    ).mock.calls.find((c: unknown[]) => c[0] === "capture_thought");
    expect(captureCall![1].embedding).toHaveLength(1536);

    // set_session_title does NOT get embedding
    const titleCall = (
      toolExecutor.callTool as ReturnType<typeof vi.fn>
    ).mock.calls.find((c: unknown[]) => c[0] === "set_session_title");
    expect(titleCall![1].embedding).toBeUndefined();
  });

  it("handles capture_thought followed by create_decision in separate rounds", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "capture_thought",
            arguments: JSON.stringify({
              content: "Car needs an oil change",
              decisions: [
                {
                  decision_type: "classification",
                  value: { category: "Vehicles" },
                  confidence: 0.95,
                  reasoning: "Oil change is vehicle maintenance",
                },
              ],
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
            name: "create_decision",
            arguments: JSON.stringify({
              thought_id: "t-5",
              decision_type: "tag",
              value: { label: "maintenance" },
              confidence: 0.9,
              reasoning: "Oil change is a maintenance task",
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "I've noted that your car needs an oil change.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-5", decisions: [] }),
      create_decision: JSON.stringify({ id: "d-5" }),
    });

    const result = await createExecutorAndRun(llm, toolExecutor);

    expect(result.content).toContain("oil change");
    const calls = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe("capture_thought");
    expect(calls[1][0]).toBe("create_decision");
    expect(calls[1][1].thought_id).toBe("t-5");
  });
});
