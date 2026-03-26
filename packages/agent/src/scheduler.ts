import cron from "node-cron";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Reminder checker — runs every minute, pure SQL, no LLM
// Finds due reminder decisions without existing notifications and creates them.
// ---------------------------------------------------------------------------

export async function checkReminders(supabase: SupabaseClient): Promise<number> {
  // Find reminder decisions that are due and don't already have a notification.
  // We look at thought_decisions where:
  //   - decision_type = 'reminder'
  //   - value->>'due_at' <= now()  (the reminder is due)
  //   - review_status != 'corrected' OR we use corrected_value for corrected ones
  //   - No matching notification exists (LEFT JOIN notifications WHERE notifications.decision_id = td.id)
  const { data: candidates, error } = await supabase.rpc("get_due_reminders");

  if (error) {
    // Fallback: manual query if the RPC doesn't exist yet
    console.warn("get_due_reminders RPC not available, using fallback query:", error.message);
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

async function checkRemindersFallback(supabase: SupabaseClient): Promise<number> {
  // Get all due reminder decisions
  const { data: decisions, error: decError } = await supabase
    .from("thought_decisions")
    .select("id, thought_id, value, corrected_value, review_status, thoughts(id, content, created_by)")
    .eq("decision_type", "reminder")
    .lte("value->>due_at", new Date().toISOString());

  if (decError || !decisions?.length) return 0;

  // Also include corrected reminders where corrected_value has a due date
  // Filter to those that are actually due
  const now = new Date();
  const dueDecisions = decisions.filter((d) => {
    const value = d.review_status === "corrected" && d.corrected_value
      ? d.corrected_value as { due_at?: string; description?: string }
      : d.value as { due_at?: string; description?: string };
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
      const thought = d.thoughts as unknown as { id: string; content: string; created_by: string };
      const value = d.review_status === "corrected" && d.corrected_value
        ? d.corrected_value as { due_at: string; description: string }
        : d.value as { due_at: string; description: string };
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
  candidates: ReminderCandidate[],
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
// Scheduler — starts all cron jobs
// ---------------------------------------------------------------------------

export function startScheduler(supabase: SupabaseClient): void {
  // Reminder checker: every minute
  cron.schedule("* * * * *", async () => {
    try {
      await checkReminders(supabase);
    } catch (err) {
      console.error("Reminder checker error:", err);
    }
  });

  console.log("Scheduler started: reminder checker (every 1 min).");
}
