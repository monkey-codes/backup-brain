import type { Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Database helper
// ---------------------------------------------------------------------------

let _supabase: SupabaseClient | null = null;

/** Returns a Supabase client using the service role key (bypasses RLS). */
function getServiceClient(): SupabaseClient {
  if (_supabase) return _supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment"
    );
  }

  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

/**
 * Query a database table with optional equality filters.
 *
 * @example
 *   const rows = await queryDb("thoughts", { created_by: userId });
 *   const decisions = await queryDb("thought_decisions", { thought_id: id, decision_type: "reminder" });
 */
export async function queryDb<T = Record<string, unknown>>(
  table: string,
  filters: Record<string, unknown> = {}
): Promise<T[]> {
  const supabase = getServiceClient();
  let query = supabase.from(table).select("*");

  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value as string);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`queryDb(${table}) failed: ${error.message}`);
  }

  return (data ?? []) as T[];
}

/**
 * Delete all data owned by a test user (thoughts, decisions, messages, sessions, notifications).
 * Use in beforeEach to ensure test isolation.
 */
export async function cleanupUserData(userId: string): Promise<void> {
  const supabase = getServiceClient();

  // Get all sessions for the user
  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("user_id", userId);

  if (sessions?.length) {
    const sessionIds = sessions.map((s) => s.id);
    await supabase.from("chat_messages").delete().in("session_id", sessionIds);
    await supabase.from("chat_sessions").delete().eq("user_id", userId);
  }

  // Get all thoughts for the user
  const { data: thoughts } = await supabase
    .from("thoughts")
    .select("id")
    .eq("created_by", userId);

  if (thoughts?.length) {
    const thoughtIds = thoughts.map((t) => t.id);
    await supabase
      .from("thought_decisions")
      .delete()
      .in("thought_id", thoughtIds);
    await supabase.from("thoughts").delete().eq("created_by", userId);
  }

  await supabase.from("notifications").delete().eq("user_id", userId);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Type a message into the chat input and submit it.
 */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-testid="chat-input"]');
  await input.fill(text);
  await page.locator('[aria-label="Send message"]').click();
}

/**
 * Wait for a **new** assistant reply to appear in the chat UI.
 *
 * Counts the assistant messages already visible, then waits until a new one
 * appears. Returns the text content of the new message.
 */
export async function waitForAssistantReply(page: Page): Promise<string> {
  const selector = '[data-testid="chat-message"][data-role="assistant"]';
  const existingCount = await page.locator(selector).count();

  // Wait for the (N+1)th assistant message to appear
  const newMessage = page.locator(selector).nth(existingCount);
  await newMessage.waitFor({ state: "visible", timeout: 120_000 });

  // The thinking indicator may still be showing — wait for actual content.
  // Assistant messages render markdown inside the element; wait until text is
  // non-empty (ignore whitespace).
  await newMessage.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if ((el.textContent ?? "").trim().length > 0) {
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      })
  );

  return (await newMessage.textContent()) ?? "";
}

/**
 * Navigate to the app and create the first chat session.
 *
 * On first load with no sessions, the app shows "Select a conversation or
 * start a new one" — there is no chat input until a session is created.
 * This helper navigates to "/", clicks "New Chat", and waits for the chat
 * input to become visible.
 */
export async function navigateAndStartChat(page: Page): Promise<void> {
  await page.goto("/");

  // Open the session drawer (closed by default, button is off-viewport)
  await page.locator('[data-testid="menu-button"]').click();
  await page
    .locator('[data-testid="session-drawer"][data-open="true"]')
    .waitFor({ state: "visible", timeout: 10_000 });

  // Click "+ New Chat"
  await page.locator('[data-testid="new-chat-button"]').click();

  // Wait for drawer to close and chat input to appear
  await page
    .locator('[data-testid="chat-input"]')
    .waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Create a new chat session via the UI and wait for it to load.
 *
 * Opens the session drawer, clicks "+ New Chat", waits for the drawer to
 * close and the chat input to be ready. Use this when already in an active
 * session (e.g., for cross-session tests).
 */
export async function createNewSession(page: Page): Promise<void> {
  // Open the session drawer
  await page.locator('[data-testid="menu-button"]').click();
  await page
    .locator('[data-testid="session-drawer"][data-open="true"]')
    .waitFor({ state: "visible" });

  // Click "+ New Chat"
  await page.locator('[data-testid="new-chat-button"]').click();

  // Wait for drawer to close (handleNewChat sets drawerOpen=false)
  await page
    .locator('[data-testid="session-drawer"][data-open="false"]')
    .waitFor({ state: "attached", timeout: 15_000 });

  // Wait for the chat input to be ready
  await page
    .locator('[data-testid="chat-input"]')
    .waitFor({ state: "visible" });
}
