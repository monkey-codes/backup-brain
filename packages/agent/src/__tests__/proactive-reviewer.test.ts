import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  selectCandidates,
  getLastRunTime,
  setLastRunTime,
  processReviewerBatch,
  runProactiveReviewer,
  type ReviewerCandidate,
  type ReviewerDeps,
} from "../scheduler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockSupabaseConfig {
  lowConfidenceResult?: { data: unknown; error: unknown };
  correctedResult?: { data: unknown; error: unknown };
  agentStateSelectResult?: { data: unknown; error: unknown };
  agentStateUpsertResult?: { error: unknown };
  thoughtUserResult?: { data: unknown; error: unknown };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockSupabase(config: MockSupabaseConfig): any {
  const upsertFn = vi.fn(
    async () => config.agentStateUpsertResult ?? { error: null }
  );

  return {
    from: vi.fn((table: string) => {
      if (table === "thought_decisions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, val: string) => {
              if (val === "pending") {
                return {
                  lt: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(
                        () =>
                          config.lowConfidenceResult ?? {
                            data: [],
                            error: null,
                          }
                      ),
                    })),
                  })),
                };
              }
              if (val === "corrected") {
                return {
                  order: vi.fn(() => ({
                    limit: vi.fn(
                      () => config.correctedResult ?? { data: [], error: null }
                    ),
                  })),
                };
              }
              return {};
            }),
          })),
        };
      }
      if (table === "agent_state") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(
                async () =>
                  config.agentStateSelectResult ?? { data: null, error: null }
              ),
            })),
          })),
          upsert: upsertFn,
        };
      }
      if (table === "thoughts") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(
                async () =>
                  config.thoughtUserResult ?? {
                    data: { created_by: "user-1" },
                    error: null,
                  }
              ),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
        upsert: upsertFn,
      };
    }),
    rpc: vi.fn(async () => ({ data: [], error: null })),
    _upsertFn: upsertFn,
  };
}

function createMockLLM(
  responses: Array<{
    content: string | null;
    tool_calls: Array<{ id: string; name: string; arguments: string }>;
    finish_reason: "stop" | "tool_calls";
  }>
) {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => {
      const resp = responses[callIndex] ?? {
        content: null,
        tool_calls: [],
        finish_reason: "stop" as const,
      };
      callIndex++;
      return resp;
    }),
  };
}

function createMockMcp(toolCallResults: Record<string, string> = {}) {
  return {
    listTools: vi.fn(async () => [
      {
        name: "update_decision",
        description: "Update a decision",
        parameters: {},
      },
      { name: "create_group", description: "Create a group", parameters: {} },
      {
        name: "create_notification",
        description: "Create a notification",
        parameters: {},
      },
      { name: "list_decisions", description: "List decisions", parameters: {} },
      {
        name: "search_thoughts",
        description: "Search thoughts",
        parameters: {},
      },
      {
        name: "capture_thought",
        description: "Should be filtered out",
        parameters: {},
      },
    ]),
    callTool: vi.fn(
      async (name: string) => toolCallResults[name] ?? '{"ok": true}'
    ),
  };
}

function createMockEmbedding() {
  return {
    embed: vi.fn(async () => new Array(1536).fill(0)),
  };
}

function makeCandidateDecision(
  overrides: Partial<{
    id: string;
    thought_id: string;
    decision_type: string;
    value: Record<string, unknown>;
    confidence: number;
    reasoning: string;
    review_status: string;
    corrected_value: Record<string, unknown> | null;
    corrected_at: string | null;
    thought_content: string;
  }> = {}
) {
  const thoughtId = overrides.thought_id ?? "thought-1";
  return {
    id: overrides.id ?? "dec-1",
    thought_id: thoughtId,
    decision_type: overrides.decision_type ?? "classification",
    value: overrides.value ?? { category: "Uncategorized" },
    confidence: overrides.confidence ?? 0.4,
    reasoning: overrides.reasoning ?? "Not sure about this",
    review_status: overrides.review_status ?? "pending",
    corrected_value: overrides.corrected_value ?? null,
    corrected_at: overrides.corrected_at ?? null,
    thoughts: {
      id: thoughtId,
      content: overrides.thought_content ?? "Test thought content",
    },
  };
}

// ---------------------------------------------------------------------------
// Tests — candidate selection
// ---------------------------------------------------------------------------

describe("selectCandidates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns low-confidence decisions", async () => {
    const supabase = createMockSupabase({
      lowConfidenceResult: {
        data: [
          makeCandidateDecision({
            id: "dec-1",
            confidence: 0.3,
            thought_content: "Fix the roof",
          }),
          makeCandidateDecision({
            id: "dec-2",
            confidence: 0.5,
            thought_content: "Buy paint",
          }),
        ],
        error: null,
      },
    });

    const candidates = await selectCandidates(supabase);

    expect(candidates).toHaveLength(2);
    expect(candidates[0].decision_id).toBe("dec-1");
    expect(candidates[0].confidence).toBe(0.3);
    expect(candidates[1].decision_id).toBe("dec-2");
  });

  it("includes corrected decisions when under the cap", async () => {
    const supabase = createMockSupabase({
      lowConfidenceResult: {
        data: [makeCandidateDecision({ id: "dec-lc", confidence: 0.4 })],
        error: null,
      },
      correctedResult: {
        data: [
          makeCandidateDecision({
            id: "dec-corrected",
            review_status: "corrected",
            confidence: 0.9,
            corrected_value: { category: "Vehicles" },
          }),
        ],
        error: null,
      },
    });

    const candidates = await selectCandidates(supabase);

    expect(candidates).toHaveLength(2);
    const ids = candidates.map((c) => c.decision_id);
    expect(ids).toContain("dec-lc");
    expect(ids).toContain("dec-corrected");
  });

  it("deduplicates decisions", async () => {
    const dup = makeCandidateDecision({ id: "dec-dup", confidence: 0.5 });
    const supabase = createMockSupabase({
      lowConfidenceResult: { data: [dup], error: null },
      correctedResult: { data: [dup], error: null },
    });

    const candidates = await selectCandidates(supabase);
    expect(candidates).toHaveLength(1);
  });

  it("returns empty array on query error", async () => {
    const supabase = createMockSupabase({
      lowConfidenceResult: { data: null, error: { message: "query failed" } },
    });

    const candidates = await selectCandidates(supabase);
    expect(candidates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — agent_state last-run tracking
// ---------------------------------------------------------------------------

describe("getLastRunTime", () => {
  it("returns null when no state exists", async () => {
    const supabase = createMockSupabase({
      agentStateSelectResult: { data: null, error: { message: "not found" } },
    });

    const result = await getLastRunTime(supabase);
    expect(result).toBeNull();
  });

  it("returns the stored timestamp", async () => {
    const supabase = createMockSupabase({
      agentStateSelectResult: {
        data: { value: { last_run: "2026-03-25T12:00:00Z" } },
        error: null,
      },
    });

    const result = await getLastRunTime(supabase);
    expect(result).toEqual(new Date("2026-03-25T12:00:00Z"));
  });
});

describe("setLastRunTime", () => {
  it("upserts the agent_state row", async () => {
    const supabase = createMockSupabase({});
    const time = new Date("2026-03-26T06:00:00Z");

    await setLastRunTime(supabase, time);

    expect(supabase.from).toHaveBeenCalledWith("agent_state");
    expect(supabase._upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "proactive_reviewer_last_run",
        value: { last_run: "2026-03-26T06:00:00.000Z" },
      }),
      { onConflict: "key" }
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — LLM integration (mock)
// ---------------------------------------------------------------------------

describe("processReviewerBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends candidates to LLM and executes tool calls", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "tc-1",
            name: "update_decision",
            arguments: JSON.stringify({
              decision_id: "dec-1",
              review_status: "accepted",
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "Done reviewing.", tool_calls: [], finish_reason: "stop" },
    ]);

    const mcp = createMockMcp();
    const embedding = createMockEmbedding();
    const supabase = createMockSupabase({
      thoughtUserResult: { data: { created_by: "user-1" }, error: null },
    });

    const candidates: ReviewerCandidate[] = [
      {
        thought_id: "thought-1",
        thought_content: "Fix the roof leak",
        decision_id: "dec-1",
        decision_type: "classification",
        value: { category: "Uncategorized" },
        confidence: 0.3,
        reasoning: "Not sure",
        review_status: "pending",
        corrected_value: null,
      },
    ];

    await processReviewerBatch(
      { supabase, llm, embedding, mcp } as unknown as ReviewerDeps,
      candidates
    );

    // LLM was called
    expect(llm.chat).toHaveBeenCalledTimes(2);

    // MCP tool was called with update_decision
    expect(mcp.callTool).toHaveBeenCalledWith("update_decision", {
      decision_id: "dec-1",
      review_status: "accepted",
    });
  });

  it("filters tools to only reviewer-relevant ones", async () => {
    const llm = createMockLLM([
      { content: "Nothing to do.", tool_calls: [], finish_reason: "stop" },
    ]);
    const mcp = createMockMcp();
    const embedding = createMockEmbedding();
    const supabase = createMockSupabase({});

    const candidates: ReviewerCandidate[] = [
      {
        thought_id: "thought-1",
        thought_content: "Test",
        decision_id: "dec-1",
        decision_type: "classification",
        value: { category: "Test" },
        confidence: 0.5,
        reasoning: "Testing",
        review_status: "pending",
        corrected_value: null,
      },
    ];

    await processReviewerBatch(
      { supabase, llm, embedding, mcp } as unknown as ReviewerDeps,
      candidates
    );

    // Verify the tools passed to LLM don't include capture_thought
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolsArg = (llm.chat.mock.calls[0] as any[])[1] as Array<{
      name: string;
    }>;
    const toolNames = toolsArg.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("update_decision");
    expect(toolNames).toContain("create_group");
    expect(toolNames).toContain("create_notification");
    expect(toolNames).not.toContain("capture_thought");
    expect(toolNames).not.toContain("set_session_title");
  });

  it("creates groups when LLM identifies related thoughts", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "tc-group",
            name: "create_group",
            arguments: JSON.stringify({
              name: "Home Repairs",
              description: "Thoughts related to home repairs",
              thought_ids: ["thought-1", "thought-2"],
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "Grouped.", tool_calls: [], finish_reason: "stop" },
    ]);

    const mcp = createMockMcp();
    const embedding = createMockEmbedding();
    const supabase = createMockSupabase({});

    const candidates: ReviewerCandidate[] = [
      {
        thought_id: "thought-1",
        thought_content: "Fix the roof",
        decision_id: "dec-1",
        decision_type: "classification",
        value: { category: "Home Maintenance" },
        confidence: 0.4,
        reasoning: "Seems like home stuff",
        review_status: "pending",
        corrected_value: null,
      },
      {
        thought_id: "thought-2",
        thought_content: "Repaint the fence",
        decision_id: "dec-2",
        decision_type: "classification",
        value: { category: "Home Maintenance" },
        confidence: 0.5,
        reasoning: "Home maintenance task",
        review_status: "pending",
        corrected_value: null,
      },
    ];

    await processReviewerBatch(
      { supabase, llm, embedding, mcp } as unknown as ReviewerDeps,
      candidates
    );

    expect(mcp.callTool).toHaveBeenCalledWith("create_group", {
      name: "Home Repairs",
      description: "Thoughts related to home repairs",
      thought_ids: ["thought-1", "thought-2"],
    });
  });

  it("creates insight notifications when LLM finds patterns", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "tc-insight",
            name: "create_notification",
            arguments: JSON.stringify({
              user_id: "user-1",
              type: "insight",
              title: "Home maintenance trend",
              body: "You've captured several home maintenance thoughts recently. Consider creating a project to track these.",
            }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "Insight created.", tool_calls: [], finish_reason: "stop" },
    ]);

    const mcp = createMockMcp();
    const embedding = createMockEmbedding();
    const supabase = createMockSupabase({
      thoughtUserResult: { data: { created_by: "user-1" }, error: null },
    });

    const candidates: ReviewerCandidate[] = [
      {
        thought_id: "thought-1",
        thought_content: "Fix the roof",
        decision_id: "dec-1",
        decision_type: "classification",
        value: { category: "Home Maintenance" },
        confidence: 0.6,
        reasoning: "Home task",
        review_status: "pending",
        corrected_value: null,
      },
    ];

    await processReviewerBatch(
      { supabase, llm, embedding, mcp } as unknown as ReviewerDeps,
      candidates
    );

    expect(mcp.callTool).toHaveBeenCalledWith(
      "create_notification",
      expect.objectContaining({
        user_id: "user-1",
        type: "insight",
        title: "Home maintenance trend",
      })
    );
  });

  it("handles search_thoughts by embedding the query", async () => {
    const llm = createMockLLM([
      {
        content: null,
        tool_calls: [
          {
            id: "tc-search",
            name: "search_thoughts",
            arguments: JSON.stringify({ query: "home repairs" }),
          },
        ],
        finish_reason: "tool_calls",
      },
      { content: "Searched.", tool_calls: [], finish_reason: "stop" },
    ]);

    const mcp = createMockMcp({ search_thoughts: "[]" });
    const embedding = createMockEmbedding();
    const supabase = createMockSupabase({});

    const candidates: ReviewerCandidate[] = [
      {
        thought_id: "thought-1",
        thought_content: "Test",
        decision_id: "dec-1",
        decision_type: "classification",
        value: { category: "Test" },
        confidence: 0.5,
        reasoning: "Testing",
        review_status: "pending",
        corrected_value: null,
      },
    ];

    await processReviewerBatch(
      { supabase, llm, embedding, mcp } as unknown as ReviewerDeps,
      candidates
    );

    // Embedding should have been called with the query
    expect(embedding.embed).toHaveBeenCalledWith("home repairs");

    // MCP should receive embedding, not query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchCall = (mcp.callTool.mock.calls as any[]).find(
      (c: unknown[]) => c[0] === "search_thoughts"
    );
    expect(searchCall).toBeDefined();
    const searchArgs = searchCall[1] as Record<string, unknown>;
    expect(searchArgs).toHaveProperty("embedding");
    expect(searchArgs).not.toHaveProperty("query");
  });
});

// ---------------------------------------------------------------------------
// Tests — runProactiveReviewer (end-to-end with mocks)
// ---------------------------------------------------------------------------

describe("runProactiveReviewer", () => {
  it("tracks last run time even when no candidates found", async () => {
    const supabase = createMockSupabase({
      lowConfidenceResult: { data: [], error: null },
    });
    const llm = createMockLLM([]);
    const mcp = createMockMcp();
    const embedding = createMockEmbedding();

    const count = await runProactiveReviewer({
      supabase,
      llm,
      embedding,
      mcp,
    } as unknown as ReviewerDeps);

    expect(count).toBe(0);
    expect(supabase._upsertFn).toHaveBeenCalled();
  });

  it("processes candidates and tracks last run time", async () => {
    const supabase = createMockSupabase({
      lowConfidenceResult: {
        data: [makeCandidateDecision({ id: "dec-1", confidence: 0.3 })],
        error: null,
      },
      thoughtUserResult: { data: { created_by: "user-1" }, error: null },
    });

    const llm = createMockLLM([
      { content: "Reviewed.", tool_calls: [], finish_reason: "stop" },
    ]);
    const mcp = createMockMcp();
    const embedding = createMockEmbedding();

    const count = await runProactiveReviewer({
      supabase,
      llm,
      embedding,
      mcp,
    } as unknown as ReviewerDeps);

    expect(count).toBe(1);
    expect(llm.chat).toHaveBeenCalled();
    expect(supabase._upsertFn).toHaveBeenCalled();
  });
});
