import { describe, it, expect, vi } from "vitest";
import { processMessage, type ProcessContext } from "../react-loop.js";
import type {
  LLMProvider,
  LLMResponse,
  EmbeddingProvider,
} from "../llm-provider.js";
import type { McpClient } from "../mcp-client.js";
import type { ToolDefinition } from "../llm-provider.js";

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
    callTool: vi.fn(async (name: string) => {
      if (name === "list_decisions" && !results[name]) return "[]";
      return results[name] ?? "{}";
    }),
    listTools: vi.fn(async () => []),
    initialize: vi.fn(async () => {}),
  } as unknown as McpClient;
}

/** Filter mcp.callTool mock calls, excluding internal list_decisions calls */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getToolCalls(mcp: McpClient): any[][] {
  return (mcp.callTool as ReturnType<typeof vi.fn>).mock.calls.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any[]) => c[0] !== "list_decisions",
  );
}

function createMockEmbedding(): EmbeddingProvider {
  const fakeEmbedding = new Array(1536).fill(0.1);
  return {
    embed: vi.fn(async () => fakeEmbedding),
  };
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
      if (table === "chat_sessions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({
                data: { title: "Test Session" },
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
    description: "Create a thought with its decisions atomically",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
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
];

function buildContext(overrides: Partial<ProcessContext>): ProcessContext {
  return {
    sessionId: "sess-1",
    userId: "user-1",
    llm: createMockLLM([]),
    mcp: createMockMcp({}),
    tools: TOOLS,
    systemPrompt: "You are helpful.",
    supabase: createMockSupabase([]),
    embedding: createMockEmbedding(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — Reminder detection
// ---------------------------------------------------------------------------

describe("Reminder detection", () => {
  it("creates a reminder decision for an explicit deadline", async () => {
    const captureArgs = {
      content: "Submit the tax return by April 15th",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Finance" },
          confidence: 0.9,
          reasoning: "Tax return is a financial obligation",
        },
        {
          decision_type: "reminder",
          value: {
            due_at: "2026-04-15T09:00:00Z",
            description: "Submit the tax return",
          },
          confidence: 0.95,
          reasoning:
            "User explicitly stated a deadline of April 15th for the tax return",
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
          "Got it! I've noted your tax return deadline for April 15th and set a reminder.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const mcp = createMockMcp({
      capture_thought: JSON.stringify({ thought_id: "t-1", decisions: [] }),
    });

    const result = await processMessage(
      buildContext({
        llm,
        mcp,
        supabase: createMockSupabase([
          {
            role: "user",
            content: "I need to submit the tax return by April 15th",
          },
        ]),
      }),
    );

    expect(result).toContain("tax return");

    // Verify capture_thought was called with a reminder decision
    const callArgs = getToolCalls(mcp)[0];
    expect(callArgs[0]).toBe("capture_thought");

    const decisions = callArgs[1].decisions;
    const reminder = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "reminder",
    );
    expect(reminder).toBeDefined();
    expect(reminder.value.due_at).toBe("2026-04-15T09:00:00Z");
    expect(reminder.value.description).toBe("Submit the tax return");
    expect(reminder.confidence).toBeGreaterThanOrEqual(0.9);
    expect(reminder.reasoning).toBeTruthy();
  });

  it("creates a reminder decision for a scheduled event with relative date", async () => {
    const captureArgs = {
      content: "Dentist appointment next Tuesday at 2pm",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Health" },
          confidence: 0.85,
          reasoning: "Dentist appointment is a health-related event",
        },
        {
          decision_type: "entity",
          value: { name: "dentist", type: "person" },
          confidence: 0.7,
          reasoning: "The dentist is the person being visited",
        },
        {
          decision_type: "reminder",
          value: {
            due_at: "2026-03-31T14:00:00Z",
            description: "Dentist appointment",
          },
          confidence: 0.9,
          reasoning:
            "User mentioned a dentist appointment next Tuesday at 2pm — converted relative date to absolute",
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
        content: "I've noted your dentist appointment and set a reminder!",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const mcp = createMockMcp({
      capture_thought: JSON.stringify({ thought_id: "t-2", decisions: [] }),
    });

    await processMessage(buildContext({ llm, mcp }));

    const callArgs = getToolCalls(mcp)[0];
    const decisions = callArgs[1].decisions;
    const reminder = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "reminder",
    );

    expect(reminder).toBeDefined();
    expect(reminder.value.due_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(reminder.value.description).toContain("Dentist");
    expect(reminder.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("creates a reminder decision for follow-up tasks", async () => {
    const captureArgs = {
      content: "Call the plumber back about the kitchen leak — follow up in 3 days",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Home Maintenance" },
          confidence: 0.9,
          reasoning: "Plumbing is home maintenance",
        },
        {
          decision_type: "reminder",
          value: {
            due_at: "2026-03-29T09:00:00Z",
            description: "Follow up with plumber about kitchen leak",
          },
          confidence: 0.85,
          reasoning:
            "User wants to follow up in 3 days — converted to absolute date",
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
        content: "I'll remind you to follow up with the plumber in 3 days.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const mcp = createMockMcp({
      capture_thought: JSON.stringify({ thought_id: "t-3", decisions: [] }),
    });

    const result = await processMessage(buildContext({ llm, mcp }));

    expect(result).toContain("plumber");

    const callArgs = getToolCalls(mcp)[0];
    const decisions = callArgs[1].decisions;
    const reminder = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "reminder",
    );

    expect(reminder).toBeDefined();
    expect(reminder.decision_type).toBe("reminder");
    expect(reminder.value.description).toContain("plumber");
    expect(reminder.confidence).toBeGreaterThan(0);
    expect(reminder.confidence).toBeLessThanOrEqual(1);
    expect(reminder.reasoning).toBeTruthy();
  });

  it("includes reminder alongside other decision types in a single capture", async () => {
    const captureArgs = {
      content:
        "Meeting with Sarah at the downtown office on April 1st to review the Q1 budget",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Work" },
          confidence: 0.9,
          reasoning: "Budget review meeting is work-related",
        },
        {
          decision_type: "entity",
          value: { name: "Sarah", type: "person" },
          confidence: 0.95,
          reasoning: "Sarah is a person attending the meeting",
        },
        {
          decision_type: "entity",
          value: { name: "downtown office", type: "place" },
          confidence: 0.9,
          reasoning: "The downtown office is where the meeting takes place",
        },
        {
          decision_type: "tag",
          value: { label: "budget" },
          confidence: 0.85,
          reasoning: "Budget is the key topic of the meeting",
        },
        {
          decision_type: "tag",
          value: { label: "Q1" },
          confidence: 0.8,
          reasoning: "Q1 is the quarter being reviewed",
        },
        {
          decision_type: "reminder",
          value: {
            due_at: "2026-04-01T09:00:00Z",
            description:
              "Meeting with Sarah at downtown office to review Q1 budget",
          },
          confidence: 0.95,
          reasoning: "User specified April 1st as the meeting date",
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
        content: "Noted! I've set a reminder for your meeting with Sarah on April 1st.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const mcp = createMockMcp({
      capture_thought: JSON.stringify({ thought_id: "t-4", decisions: [] }),
    });

    await processMessage(buildContext({ llm, mcp }));

    const callArgs = getToolCalls(mcp)[0];
    const decisions = callArgs[1].decisions;

    // Verify all decision types present
    const types = decisions.map(
      (d: { decision_type: string }) => d.decision_type,
    );
    expect(types).toContain("classification");
    expect(types).toContain("entity");
    expect(types).toContain("tag");
    expect(types).toContain("reminder");

    // Verify reminder specifics
    const reminder = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "reminder",
    );
    expect(reminder.value.due_at).toBe("2026-04-01T09:00:00Z");
    expect(reminder.confidence).toBeGreaterThanOrEqual(0.9);

    // Verify all decisions have confidence and reasoning
    for (const decision of decisions) {
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(decision.reasoning).toBeTruthy();
    }
  });

  it("adds a reminder to an existing thought via create_decision", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "create_decision",
            arguments: JSON.stringify({
              thought_id: "t-existing",
              decision_type: "reminder",
              value: {
                due_at: "2026-04-10T09:00:00Z",
                description: "Renew car insurance before it expires",
              },
              confidence: 0.8,
              reasoning:
                "User mentioned insurance expiry — creating a reminder for the renewal deadline",
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content: "I've added a reminder for your car insurance renewal on April 10th.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const mcp = createMockMcp({
      create_decision: JSON.stringify({
        id: "d-new",
        decision_type: "reminder",
      }),
    });

    const result = await processMessage(
      buildContext({
        llm,
        mcp,
        supabase: createMockSupabase([
          {
            role: "user",
            content:
              "Oh and that car insurance thing — it expires April 10th, don't let me forget",
          },
        ]),
      }),
    );

    expect(result).toContain("insurance");

    expect(mcp.callTool).toHaveBeenCalledWith("create_decision", {
      thought_id: "t-existing",
      decision_type: "reminder",
      value: {
        due_at: "2026-04-10T09:00:00Z",
        description: "Renew car insurance before it expires",
      },
      confidence: 0.8,
      reasoning:
        "User mentioned insurance expiry — creating a reminder for the renewal deadline",
    });
  });
});
