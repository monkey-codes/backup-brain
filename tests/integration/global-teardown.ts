import { createClient } from "@supabase/supabase-js";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const TEST_USER_PATH = resolve(import.meta.dirname, ".test-user.json");

export default async function globalTeardown() {
  if (!existsSync(TEST_USER_PATH)) {
    return;
  }

  const { userId } = JSON.parse(readFileSync(TEST_USER_PATH, "utf-8"));

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping test user cleanup"
    );
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Clean up user-owned data in reverse dependency order (no FK cascades)
  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("user_id", userId);

  if (sessions?.length) {
    const sessionIds = sessions.map((s) => s.id);

    // Delete chat messages for all sessions
    await supabase.from("chat_messages").delete().in("session_id", sessionIds);

    // Delete chat sessions
    await supabase.from("chat_sessions").delete().eq("user_id", userId);
  }

  // Delete thoughts and their decisions
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

  // Delete notifications
  await supabase.from("notifications").delete().eq("user_id", userId);

  // Delete the auth user
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.warn(`Failed to delete test user ${userId}: ${error.message}`);
  }

  // Clean up the temp file
  unlinkSync(TEST_USER_PATH);
}
