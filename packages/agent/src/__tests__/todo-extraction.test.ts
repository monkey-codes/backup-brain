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
// Tests — Todo extraction
// ---------------------------------------------------------------------------

describe("Todo extraction", () => {
  it("extracts a todo from an explicit request with high confidence", async () => {
    const captureArgs = {
      content: "Paint the fence",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Home Maintenance" },
          confidence: 0.9,
          reasoning: "Painting a fence is home maintenance",
        },
        {
          decision_type: "todo",
          value: {
            description: "Paint the fence",
            completed_at: null,
          },
          confidence: 0.95,
          reasoning:
            "User explicitly requested to add a todo to paint the fence",
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
        content: "Got it! I've added a todo to paint the fence.",
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
        content: "Add a todo to paint the fence",
      },
    ]);

    expect(result.content).toContain("paint the fence");

    // Verify capture_thought was called with a todo decision
    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(callArgs[0]).toBe("capture_thought");

    const decisions = callArgs[1].decisions;
    const todo = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "todo"
    );
    expect(todo).toBeDefined();
    expect(todo.value.description).toBe("Paint the fence");
    expect(todo.value.completed_at).toBeNull();
    expect(todo.confidence).toBeGreaterThanOrEqual(0.9);
    expect(todo.reasoning).toBeTruthy();
  });

  it("does NOT extract a todo from aspirations", async () => {
    const captureArgs = {
      content: "User wants to learn piano someday",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Personal Goals" },
          confidence: 0.85,
          reasoning: "Learning piano is a personal aspiration",
        },
        {
          decision_type: "tag",
          value: { label: "piano" },
          confidence: 0.8,
          reasoning: "Piano is the subject mentioned",
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
          "That's a great aspiration! I've noted your interest in piano.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-2", decisions: [] }),
    });

    await createExecutorAndRun(llm, toolExecutor, [
      {
        role: "user",
        content: "I want to learn piano someday",
      },
    ]);

    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const decisions = callArgs[1].decisions;
    const todo = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "todo"
    );
    expect(todo).toBeUndefined();
  });

  it("sets completed_at to null on initial extraction", async () => {
    const captureArgs = {
      content: "Buy groceries for the week",
      decisions: [
        {
          decision_type: "todo",
          value: {
            description: "Buy groceries for the week",
            completed_at: null,
          },
          confidence: 0.92,
          reasoning: "User stated a concrete task they need to do",
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
        content: "Added! I'll track your grocery shopping todo.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-3", decisions: [] }),
    });

    await createExecutorAndRun(llm, toolExecutor, [
      {
        role: "user",
        content: "I need to buy groceries for the week",
      },
    ]);

    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const decisions = callArgs[1].decisions;
    const todo = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "todo"
    );
    expect(todo).toBeDefined();
    expect(todo.value.completed_at).toBeNull();
  });

  it("includes todo alongside other decision types in a single capture", async () => {
    const captureArgs = {
      content: "Need to send the Q1 report to Sarah by end of week",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Work" },
          confidence: 0.9,
          reasoning: "Sending a report is work-related",
        },
        {
          decision_type: "entity",
          value: { name: "Sarah", type: "person" },
          confidence: 0.95,
          reasoning: "Sarah is the recipient of the report",
        },
        {
          decision_type: "tag",
          value: { label: "Q1 report" },
          confidence: 0.85,
          reasoning: "Q1 report is the key topic",
        },
        {
          decision_type: "todo",
          value: {
            description: "Send the Q1 report to Sarah",
            completed_at: null,
          },
          confidence: 0.93,
          reasoning:
            "User stated a concrete task with clear action and recipient",
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
          "Noted! I've captured the todo to send the Q1 report to Sarah.",
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
    expect(types).toContain("todo");

    // Verify todo specifics
    const todo = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "todo"
    );
    expect(todo.value.description).toContain("Q1 report");
    expect(todo.value.completed_at).toBeNull();
    expect(todo.confidence).toBeGreaterThanOrEqual(0.9);

    // Verify all decisions have confidence and reasoning
    for (const decision of decisions) {
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(decision.reasoning).toBeTruthy();
    }
  });

  it("adds a todo to an existing thought via create_decision", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            name: "create_decision",
            arguments: JSON.stringify({
              thought_id: "t-existing",
              decision_type: "todo",
              value: {
                description: "Fix the leaking kitchen tap",
                completed_at: null,
              },
              confidence: 0.9,
              reasoning:
                "User wants to add a todo for fixing the kitchen tap they previously mentioned",
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      {
        content:
          "I've added a todo to fix the leaking kitchen tap to that thought.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      create_decision: JSON.stringify({
        id: "d-new",
        decision_type: "todo",
      }),
    });

    const result = await createExecutorAndRun(llm, toolExecutor, [
      {
        role: "user",
        content:
          "Actually, add a todo to fix the leaking kitchen tap from earlier",
      },
    ]);

    expect(result.content).toContain("kitchen tap");

    expect(toolExecutor.callTool).toHaveBeenCalledWith("create_decision", {
      thought_id: "t-existing",
      decision_type: "todo",
      value: {
        description: "Fix the leaking kitchen tap",
        completed_at: null,
      },
      confidence: 0.9,
      reasoning:
        "User wants to add a todo for fixing the kitchen tap they previously mentioned",
    });
  });

  it("extracts a todo from an implicit commitment with lower confidence", async () => {
    const captureArgs = {
      content: "I told Sarah I'd send her the report",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Work" },
          confidence: 0.85,
          reasoning: "Sending a report is work-related",
        },
        {
          decision_type: "entity",
          value: { name: "Sarah", type: "person" },
          confidence: 0.95,
          reasoning: "Sarah is the person the report is being sent to",
        },
        {
          decision_type: "todo",
          value: {
            description: "Send Sarah the report",
            completed_at: null,
          },
          confidence: 0.7,
          reasoning:
            "User made an implicit commitment to send a report to Sarah — this is a promise made to another person",
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
        content: "Noted! I've captured a todo to send Sarah the report.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-5", decisions: [] }),
    });

    const result = await createExecutorAndRun(llm, toolExecutor, [
      {
        role: "user",
        content: "I told Sarah I'd send her the report",
      },
    ]);

    expect(result.content).toContain("report");

    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(callArgs[0]).toBe("capture_thought");

    const decisions = callArgs[1].decisions;
    const todo = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "todo"
    );
    expect(todo).toBeDefined();
    expect(todo.value.description).toContain("report");
    expect(todo.value.completed_at).toBeNull();
    // Implicit commitments should have confidence 0.6–0.8
    expect(todo.confidence).toBeGreaterThanOrEqual(0.6);
    expect(todo.confidence).toBeLessThanOrEqual(0.8);
    expect(todo.reasoning).toBeTruthy();
  });

  it("creates both a todo and a reminder when time reference is present", async () => {
    const captureArgs = {
      content: "Submit tax return by April 15th",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Finance" },
          confidence: 0.9,
          reasoning: "Tax return is a financial obligation",
        },
        {
          decision_type: "todo",
          value: {
            description: "Submit tax return",
            completed_at: null,
          },
          confidence: 0.92,
          reasoning: "User has a concrete commitment to submit a tax return",
        },
        {
          decision_type: "reminder",
          value: {
            due_at: "2026-04-15T09:00:00Z",
            description: "Submit tax return",
          },
          confidence: 0.95,
          reasoning:
            "User specified April 15th as the deadline for the tax return",
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
          "Got it! I've added a todo to submit your tax return and set a reminder for April 15th.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-6", decisions: [] }),
    });

    await createExecutorAndRun(llm, toolExecutor, [
      {
        role: "user",
        content: "I need to submit my tax return by April 15th",
      },
    ]);

    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const decisions = callArgs[1].decisions;

    // Both todo and reminder should be present
    const types = decisions.map(
      (d: { decision_type: string }) => d.decision_type
    );
    expect(types).toContain("todo");
    expect(types).toContain("reminder");

    const todo = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "todo"
    );
    expect(todo.value.description).toContain("tax return");
    expect(todo.value.completed_at).toBeNull();

    const reminder = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "reminder"
    );
    expect(reminder.value.due_at).toBe("2026-04-15T09:00:00Z");
    expect(reminder.value.description).toContain("tax return");
  });

  it("creates a todo only (no reminder) when no time reference is present", async () => {
    const captureArgs = {
      content: "I need to buy groceries",
      decisions: [
        {
          decision_type: "classification",
          value: { category: "Personal" },
          confidence: 0.85,
          reasoning: "Buying groceries is a personal errand",
        },
        {
          decision_type: "todo",
          value: {
            description: "Buy groceries",
            completed_at: null,
          },
          confidence: 0.92,
          reasoning: "User stated a concrete task they need to do",
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
        content: "Added! I'll track your grocery shopping todo.",
        tool_calls: [],
        finish_reason: "stop",
      },
    ]);

    const toolExecutor = createMockToolExecutor({
      capture_thought: JSON.stringify({ thought_id: "t-7", decisions: [] }),
    });

    await createExecutorAndRun(llm, toolExecutor, [
      {
        role: "user",
        content: "I need to buy groceries",
      },
    ]);

    const callArgs = (toolExecutor.callTool as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const decisions = callArgs[1].decisions;

    // Todo should be present
    const todo = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "todo"
    );
    expect(todo).toBeDefined();
    expect(todo.value.description).toContain("groceries");

    // Reminder should NOT be present (no time reference)
    const reminder = decisions.find(
      (d: { decision_type: string }) => d.decision_type === "reminder"
    );
    expect(reminder).toBeUndefined();
  });
});
