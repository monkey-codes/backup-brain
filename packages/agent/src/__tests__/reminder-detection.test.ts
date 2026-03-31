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

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-1", decisions: [] }),
    });

    const result = await createExecutorAndRun(llm, toolExecutor, [
      {
        role: "user",
        content: "I need to submit the tax return by April 15th",
      },
    ]);

    expect(result.content).toContain("tax return");

    // Verify capture_thought was called with a reminder decision
    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(callArgs[0]).toBe("capture_thought");

    const decisions = callArgs[1].decisions;
    const reminder = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "reminder"
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

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-2", decisions: [] }),
    });

    await createExecutorAndRun(llm, toolExecutor);

    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const decisions = callArgs[1].decisions;
    const reminder = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "reminder"
    );

    expect(reminder).toBeDefined();
    expect(reminder.value.due_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
    expect(reminder.value.description).toContain("Dentist");
    expect(reminder.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("creates a reminder decision for follow-up tasks", async () => {
    const captureArgs = {
      content:
        "Call the plumber back about the kitchen leak — follow up in 3 days",
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

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-3", decisions: [] }),
    });

    const result = await createExecutorAndRun(llm, toolExecutor);

    expect(result.content).toContain("plumber");

    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const decisions = callArgs[1].decisions;
    const reminder = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "reminder"
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
        content:
          "Noted! I've set a reminder for your meeting with Sarah on April 1st.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-4", decisions: [] }),
    });

    await createExecutorAndRun(llm, toolExecutor);

    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const decisions = callArgs[1].decisions;

    // Verify all decision types present
    const types = decisions.map(
      (d: { decision_type: string }) => d.decision_type
    );
    expect(types).toContain("classification");
    expect(types).toContain("entity");
    expect(types).toContain("tag");
    expect(types).toContain("reminder");

    // Verify reminder specifics
    const reminder = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "reminder"
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
        content:
          "I've added a reminder for your car insurance renewal on April 10th.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      create_decision: JSON.stringify({
        id: "d-new",
        decision_type: "reminder",
      }),
    });

    const result = await createExecutorAndRun(llm, toolExecutor, [
      {
        role: "user",
        content:
          "Oh and that car insurance thing — it expires April 10th, don't let me forget",
      },
    ]);

    expect(result.content).toContain("insurance");

    expect(toolExecutor.callTool).toHaveBeenCalledWith("create_decision", {
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
