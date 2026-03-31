import cron from "node-cron";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LLMProvider,
  LLMMessage,
  ToolDefinition,
  EmbeddingProvider,
} from "./llm-provider.js";
import type { McpClient } from "./mcp-client.js";
import { rewriteToolsForLLM } from "./react-loop.js";

// ---------------------------------------------------------------------------
// Reminder checker — runs every minute, pure SQL, no LLM
// Finds due reminder decisions without existing notifications and creates them.
// ---------------------------------------------------------------------------

export async function checkReminders(
  supabase: SupabaseClient
): Promise<number> {
  // Find reminder decisions that are due and don't already have a notification.
  // We look at thought_decisions where:
  //   - decision_type = 'reminder'
  //   - value->>'due_at' <= now()  (the reminder is due)
  //   - review_status != 'corrected' OR we use corrected_value for corrected ones
  //   - No matching notification exists (LEFT JOIN notifications WHERE notifications.decision_id = td.id)
  const { data: candidates, error } = await supabase.rpc("get_due_reminders");

  if (error) {
    // Fallback: manual query if the RPC doesn't exist yet
    console.warn(
      "get_due_reminders RPC not available, using fallback query:",
      error.message
    );
    return checkRemindersFallback(supabase);
  }

  if (!candidates?.length) return 0;

  return createNotificationsForReminders(supabase, candidates);
}

interface ReminderCandidate {
  decision_id: string;
  thought_id: string;
  thought_content: string;
  user_id: string;
  description: string;
  due_at: string;
}

async function checkRemindersFallback(
  supabase: SupabaseClient
): Promise<number> {
  // Get all due reminder decisions
  const { data: decisions, error: decError } = await supabase
    .from("thought_decisions")
    .select(
      "id, thought_id, value, corrected_value, review_status, thoughts(id, content, created_by)"
    )
    .eq("decision_type", "reminder")
    .lte("value->>due_at", new Date().toISOString());

  if (decError || !decisions?.length) return 0;

  // Also include corrected reminders where corrected_value has a due date
  // Filter to those that are actually due
  const now = new Date();
  const dueDecisions = decisions.filter((d) => {
    const value =
      d.review_status === "corrected" && d.corrected_value
        ? (d.corrected_value as { due_at?: string; description?: string })
        : (d.value as { due_at?: string; description?: string });
    if (!value.due_at) return false;
    return new Date(value.due_at) <= now;
  });

  if (!dueDecisions.length) return 0;

  // Get existing notifications for these decisions to exclude them
  const decisionIds = dueDecisions.map((d) => d.id);
  const { data: existingNotifs } = await supabase
    .from("notifications")
    .select("decision_id")
    .in("decision_id", decisionIds);

  const notifiedIds = new Set((existingNotifs ?? []).map((n) => n.decision_id));

  const candidates: ReminderCandidate[] = dueDecisions
    .filter((d) => !notifiedIds.has(d.id))
    .map((d) => {
      const thought = d.thoughts as unknown as {
        id: string;
        content: string;
        created_by: string;
      };
      const value =
        d.review_status === "corrected" && d.corrected_value
          ? (d.corrected_value as { due_at: string; description: string })
          : (d.value as { due_at: string; description: string });
      return {
        decision_id: d.id,
        thought_id: thought.id,
        thought_content: thought.content,
        user_id: thought.created_by,
        description: value.description,
        due_at: value.due_at,
      };
    });

  return createNotificationsForReminders(supabase, candidates);
}

async function createNotificationsForReminders(
  supabase: SupabaseClient,
  candidates: ReminderCandidate[]
): Promise<number> {
  if (!candidates.length) return 0;

  const notifications = candidates.map((c) => ({
    user_id: c.user_id,
    type: "reminder" as const,
    title: `Reminder: ${c.description}`,
    body: `Due: ${new Date(c.due_at).toLocaleString()}. From thought: "${c.thought_content.slice(0, 100)}"`,
    thought_id: c.thought_id,
    decision_id: c.decision_id,
  }));

  const { error } = await supabase.from("notifications").insert(notifications);

  if (error) {
    console.error("Failed to create reminder notifications:", error.message);
    return 0;
  }

  console.log(`Created ${notifications.length} reminder notification(s).`);
  return notifications.length;
}

// ---------------------------------------------------------------------------
// Proactive reviewer — runs every 6 hours
// Two-pass process: SQL candidate selection, then LLM processing.
// Handles reclassification, grouping, and insight generation.
// ---------------------------------------------------------------------------

const REVIEWER_THOUGHT_CAP = 50;

export interface ReviewerCandidate {
  thought_id: string;
  thought_content: string;
  decision_id: string;
  decision_type: string;
  value: Record<string, unknown>;
  confidence: number;
  reasoning: string;
  review_status: string;
  corrected_value: Record<string, unknown> | null;
}

export interface ReviewerDeps {
  supabase: SupabaseClient;
  llm: LLMProvider;
  embedding: EmbeddingProvider;
  mcp: McpClient;
}

/**
 * Get the last run time from agent_state.
 */
export async function getLastRunTime(
  supabase: SupabaseClient
): Promise<Date | null> {
  const { data, error } = await supabase
    .from("agent_state")
    .select("value")
    .eq("key", "proactive_reviewer_last_run")
    .single();

  if (error || !data) return null;

  const value = data.value as { last_run?: string };
  return value.last_run ? new Date(value.last_run) : null;
}

/**
 * Set the last run time in agent_state.
 */
export async function setLastRunTime(
  supabase: SupabaseClient,
  time: Date
): Promise<void> {
  const { error } = await supabase.from("agent_state").upsert(
    {
      key: "proactive_reviewer_last_run",
      value: { last_run: time.toISOString() },
      updated_at: time.toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error(
      "Failed to update proactive reviewer last run time:",
      error.message
    );
  }
}

/**
 * Pass 1: SQL candidate selection.
 * Finds low-confidence decisions (< 0.7) and corrected decisions, capped at 50 thoughts.
 */
export async function selectCandidates(
  supabase: SupabaseClient
): Promise<ReviewerCandidate[]> {
  // Get low-confidence decisions (pending, confidence < 0.7)
  const { data: lowConfidence, error: lcError } = await supabase
    .from("thought_decisions")
    .select(
      "id, thought_id, decision_type, value, confidence, reasoning, review_status, corrected_value, thoughts(id, content)"
    )
    .eq("review_status", "pending")
    .lt("confidence", 0.7)
    .order("confidence", { ascending: true })
    .limit(REVIEWER_THOUGHT_CAP);

  if (lcError) {
    console.error("Failed to fetch low-confidence decisions:", lcError.message);
    return [];
  }

  // Get corrected decisions (user has corrected, good for learning patterns)
  const remaining = REVIEWER_THOUGHT_CAP - (lowConfidence?.length ?? 0);
  let corrected: typeof lowConfidence = [];

  if (remaining > 0) {
    const { data, error } = await supabase
      .from("thought_decisions")
      .select(
        "id, thought_id, decision_type, value, confidence, reasoning, review_status, corrected_value, thoughts(id, content)"
      )
      .eq("review_status", "corrected")
      .order("corrected_at", { ascending: false })
      .limit(remaining);

    if (!error && data) {
      corrected = data;
    }
  }

  const all = [...(lowConfidence ?? []), ...(corrected ?? [])];

  // Deduplicate by decision_id
  const seen = new Set<string>();
  const candidates: ReviewerCandidate[] = [];

  for (const d of all) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);

    const thought = d.thoughts as unknown as { id: string; content: string };
    candidates.push({
      thought_id: thought.id,
      thought_content: thought.content,
      decision_id: d.id,
      decision_type: d.decision_type,
      value: d.value as Record<string, unknown>,
      confidence: d.confidence,
      reasoning: d.reasoning,
      review_status: d.review_status,
      corrected_value: d.corrected_value as Record<string, unknown> | null,
    });
  }

  return candidates;
}

const REVIEWER_SYSTEM_PROMPT = `You are the Backup Brain proactive reviewer. You are reviewing a batch of thoughts and their decisions to improve data quality.

You have three responsibilities:

## 1. Reclassification

For each candidate decision provided, evaluate whether the current classification is correct:
- If the decision is low-confidence and you believe a different value is more appropriate, use \`update_decision\` to correct it (set review_status to "accepted" with the same value if it's correct, or provide a corrected_value if it's wrong).
- If the decision was already corrected by the user, learn from the correction pattern — do NOT re-correct it.
- When reclassifying, use higher confidence scores when you're sure.

## 2. Grouping

Look for related thoughts in the batch that could be grouped together:
- Thoughts about the same topic, project, or entity should be grouped.
- Use \`create_group\` to create a group with a descriptive name and add the related thought IDs.
- Only create groups of 2+ thoughts. Don't force grouping — only group when there's a clear relationship.

## 3. Insight generation

Look for patterns across the batch of thoughts:
- Recurring themes or topics that the user might want to know about.
- Connections between thoughts that aren't immediately obvious.
- Use \`create_notification\` with type "insight" to surface interesting patterns.
- Keep insights concise and actionable.
- Only create notifications when there's genuine value — don't generate noise.

## Guidelines

- Work through the candidates systematically.
- For reclassification, consider the thought content and the existing decision together.
- For grouping, look at the thought content across all candidates.
- For insights, look for meta-patterns (e.g., "You've captured 5 thoughts about home maintenance this week").
- Be conservative — it's better to skip a marginal action than to create noise.
`;

/**
 * Pass 2: LLM processing.
 * Sends candidates to the LLM for reclassification, grouping, and insight generation.
 */
export async function processReviewerBatch(
  deps: ReviewerDeps,
  candidates: ReviewerCandidate[]
): Promise<void> {
  const tools = await deps.mcp.listTools();
  // Only expose the tools the reviewer needs
  const reviewerToolNames = new Set([
    "update_decision",
    "create_group",
    "create_notification",
    "list_decisions",
    "search_thoughts",
  ]);
  const filteredTools = tools.filter((t) => reviewerToolNames.has(t.name));
  const llmTools = rewriteToolsForLLM(filteredTools);

  // Build the user message with candidate data
  const candidateDescriptions = candidates
    .map(
      (c, i) =>
        `### Candidate ${i + 1}
- **Thought ID**: ${c.thought_id}
- **Thought content**: "${c.thought_content}"
- **Decision ID**: ${c.decision_id}
- **Decision type**: ${c.decision_type}
- **Current value**: ${JSON.stringify(c.value)}
- **Confidence**: ${c.confidence}
- **Reasoning**: "${c.reasoning}"
- **Review status**: ${c.review_status}${c.corrected_value ? `\n- **Corrected value**: ${JSON.stringify(c.corrected_value)}` : ""}`
    )
    .join("\n\n");

  // Get a user_id from one of the candidates for creating notifications
  // We need to query for this since candidates don't carry user_id
  const { data: thoughtData } = await deps.supabase
    .from("thoughts")
    .select("created_by")
    .eq("id", candidates[0].thought_id)
    .single();

  const userId = thoughtData?.created_by ?? "unknown";

  const messages: LLMMessage[] = [
    { role: "system", content: REVIEWER_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Review the following ${candidates.length} candidate decisions. For notifications, use user_id: "${userId}".\n\n${candidateDescriptions}`,
    },
  ];

  const MAX_ROUNDS = 10;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await deps.llm.chat(messages, llmTools);

    if (response.finish_reason === "stop" || response.tool_calls.length === 0) {
      break;
    }

    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.tool_calls,
    });

    for (const tc of response.tool_calls) {
      let result: string;
      try {
        const args = JSON.parse(tc.arguments);

        // Handle search_thoughts embedding conversion
        if (tc.name === "search_thoughts" && args.query) {
          args.embedding = await deps.embedding.embed(args.query);
          delete args.query;
        }

        result = await deps.mcp.callTool(tc.name, args);
      } catch (error) {
        result = JSON.stringify({ error: String(error) });
      }

      messages.push({
        role: "tool",
        content: result,
        tool_call_id: tc.id,
      });
    }
  }
}

/**
 * Main proactive reviewer function.
 * Called by the cron scheduler every 6 hours.
 */
export async function runProactiveReviewer(
  deps: ReviewerDeps
): Promise<number> {
  console.log("Proactive reviewer starting...");

  // Pass 1: Select candidates
  const candidates = await selectCandidates(deps.supabase);

  if (candidates.length === 0) {
    console.log("Proactive reviewer: no candidates to review.");
    await setLastRunTime(deps.supabase, new Date());
    return 0;
  }

  console.log(`Proactive reviewer: found ${candidates.length} candidate(s).`);

  // Pass 2: LLM processing
  await processReviewerBatch(deps, candidates);

  // Track last run time
  await setLastRunTime(deps.supabase, new Date());

  console.log("Proactive reviewer completed.");
  return candidates.length;
}

// ---------------------------------------------------------------------------
// Scheduler — starts all cron jobs
// ---------------------------------------------------------------------------

export function startScheduler(
  supabase: SupabaseClient,
  reviewerDeps?: ReviewerDeps
): void {
  // Reminder checker: every minute
  cron.schedule("* * * * *", async () => {
    try {
      await checkReminders(supabase);
    } catch (err) {
      console.error("Reminder checker error:", err);
    }
  });

  // Proactive reviewer: every 6 hours
  if (reviewerDeps) {
    cron.schedule("0 */6 * * *", async () => {
      try {
        await runProactiveReviewer(reviewerDeps);
      } catch (err) {
        console.error("Proactive reviewer error:", err);
      }
    });
    console.log(
      "Scheduler started: reminder checker (every 1 min), proactive reviewer (every 6 hrs)."
    );
  } else {
    console.log("Scheduler started: reminder checker (every 1 min).");
  }
}
