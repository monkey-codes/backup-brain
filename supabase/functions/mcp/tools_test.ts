/**
 * Integration tests for the MCP Edge Function.
 *
 * Prerequisites:
 *   1. supabase start
 *   2. supabase functions serve --no-verify-jwt
 *
 * Run:
 *   deno test --allow-net --allow-env supabase/functions/mcp/tools_test.ts
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const MCP_URL = `${SUPABASE_URL}/functions/v1/mcp`;

const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mcpRequest(method: string, params?: unknown, id: number = 1) {
  const body: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (params !== undefined) body.params = params;
  if (method.startsWith("notifications/")) {
    // Notifications have no id
  } else {
    body.id = id;
  }

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

async function callTool(name: string, args: unknown) {
  const res = await mcpRequest("tools/call", { name, arguments: args });
  const json = await res.json();
  assertExists(json.result, `Expected result for tool ${name}`);
  const text = json.result.content?.[0]?.text;
  assertExists(text, `Expected text content for tool ${name}`);
  return { ...json, parsed: JSON.parse(text), isError: json.result.isError };
}

function dummyEmbedding(): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(i) * 0.01);
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let testUserId: string;
let testSessionId: string;
const createdIds: {
  thoughts: string[];
  groups: string[];
  notifications: string[];
} = { thoughts: [], groups: [], notifications: [] };

async function setup() {
  // Create a test user via admin API
  const { data: userData, error: userErr } =
    await supabase.auth.admin.createUser({
      email: `mcp-test-${Date.now()}@test.local`,
      password: "test-password-123",
      email_confirm: true,
    });
  if (userErr)
    throw new Error(`Failed to create test user: ${userErr.message}`);
  testUserId = userData.user!.id;

  // Create a test session
  const { data: session, error: sessErr } = await supabase
    .from("chat_sessions")
    .insert({ user_id: testUserId, title: "MCP Test Session" })
    .select("id")
    .single();
  if (sessErr)
    throw new Error(`Failed to create test session: ${sessErr.message}`);
  testSessionId = session.id;
}

async function teardown() {
  // Clean up in reverse dependency order
  for (const id of createdIds.notifications) {
    await supabase.from("notifications").delete().eq("id", id);
  }
  for (const id of createdIds.groups) {
    await supabase.from("thought_group_members").delete().eq("group_id", id);
    await supabase.from("thought_groups").delete().eq("id", id);
  }
  for (const id of createdIds.thoughts) {
    await supabase.from("thought_decisions").delete().eq("thought_id", id);
    await supabase.from("thoughts").delete().eq("id", id);
  }
  await supabase.from("chat_sessions").delete().eq("id", testSessionId);
  await supabase.auth.admin.deleteUser(testUserId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test({
  name: "MCP integration tests",
  async fn(t) {
    await setup();

    try {
      // ---- Protocol tests ----

      await t.step(
        "initialize returns server info and capabilities",
        async () => {
          const res = await mcpRequest("initialize", {
            protocolVersion: "2025-03-26",
            clientInfo: { name: "test", version: "1.0.0" },
            capabilities: {},
          });
          const json = await res.json();
          assertEquals(json.result.serverInfo.name, "backup-brain");
          assertEquals(json.result.capabilities.tools !== undefined, true);
        }
      );

      await t.step("notifications/initialized returns 202", async () => {
        const res = await mcpRequest("notifications/initialized");
        assertEquals(res.status, 202);
      });

      await t.step("ping returns empty result", async () => {
        const res = await mcpRequest("ping");
        const json = await res.json();
        assertEquals(json.result !== undefined, true);
      });

      await t.step("tools/list returns all 10 tools", async () => {
        const res = await mcpRequest("tools/list");
        const json = await res.json();
        assertEquals(json.result.tools.length, 10);
        const names = json.result.tools.map((t: { name: string }) => t.name);
        for (const expected of [
          "capture_thought",
          "update_thought",
          "search_thoughts",
          "list_thoughts",
          "create_decision",
          "update_decision",
          "list_decisions",
          "create_group",
          "create_notification",
          "set_session_title",
        ]) {
          assertEquals(
            names.includes(expected),
            true,
            `Missing tool: ${expected}`
          );
        }
      });

      // ---- capture_thought (atomicity) ----

      let thoughtId: string;
      let decisionIds: string[];

      await t.step(
        "capture_thought creates thought + decisions atomically",
        async () => {
          const { parsed, isError } = await callTool("capture_thought", {
            content: "Need to call the plumber about the kitchen sink leak",
            session_id: testSessionId,
            created_by: testUserId,
            embedding: dummyEmbedding(),
            decisions: [
              {
                decision_type: "classification",
                value: { category: "Home Maintenance" },
                confidence: 0.92,
                reasoning: "Relates to home repair task",
              },
              {
                decision_type: "entity",
                value: { name: "plumber", type: "person" },
                confidence: 0.85,
                reasoning: "Key person mentioned",
              },
              {
                decision_type: "tag",
                value: { label: "urgent" },
                confidence: 0.7,
                reasoning: "Leak implies urgency",
              },
            ],
          });

          assertEquals(isError, undefined);
          assertExists(parsed.thought_id);
          assertEquals(parsed.decisions.length, 3);

          thoughtId = parsed.thought_id;
          decisionIds = parsed.decisions.map((d: { id: string }) => d.id);
          createdIds.thoughts.push(thoughtId);

          // Verify in database
          const { data: dbThought } = await supabase
            .from("thoughts")
            .select("id, content")
            .eq("id", thoughtId)
            .single();
          assertExists(dbThought);
          assertEquals(
            dbThought.content,
            "Need to call the plumber about the kitchen sink leak"
          );

          const { data: dbDecisions } = await supabase
            .from("thought_decisions")
            .select("id, decision_type")
            .eq("thought_id", thoughtId);
          assertEquals(dbDecisions!.length, 3);
        }
      );

      // ---- update_thought ----

      await t.step("update_thought updates content", async () => {
        const { parsed, isError } = await callTool("update_thought", {
          thought_id: thoughtId,
          content:
            "Call the plumber about kitchen sink — leak is getting worse",
        });

        assertEquals(isError, undefined);
        assertEquals(parsed.id, thoughtId);

        const { data } = await supabase
          .from("thoughts")
          .select("content")
          .eq("id", thoughtId)
          .single();
        assertEquals(
          data!.content,
          "Call the plumber about kitchen sink — leak is getting worse"
        );
      });

      // ---- list_thoughts ----

      await t.step("list_thoughts returns thoughts for session", async () => {
        const { parsed, isError } = await callTool("list_thoughts", {
          session_id: testSessionId,
        });

        assertEquals(isError, undefined);
        assertEquals(parsed.length >= 1, true);
        assertEquals(parsed[0].id, thoughtId);
      });

      // ---- search_thoughts ----

      await t.step(
        "search_thoughts returns results with similarity",
        async () => {
          const { parsed, isError } = await callTool("search_thoughts", {
            embedding: dummyEmbedding(),
            match_threshold: 0.0,
            match_count: 5,
          });

          assertEquals(isError, undefined);
          assertEquals(Array.isArray(parsed), true);
          // Our thought should match itself (same embedding)
          assertEquals(parsed.length >= 1, true);
          assertExists(parsed[0].similarity);
        }
      );

      // ---- create_decision ----

      await t.step("create_decision adds a decision to a thought", async () => {
        const { parsed, isError } = await callTool("create_decision", {
          thought_id: thoughtId,
          decision_type: "reminder",
          value: {
            due_at: "2026-04-01T09:00:00Z",
            description: "Call the plumber",
          },
          confidence: 0.88,
          reasoning: "Time-sensitive action detected",
        });

        assertEquals(isError, undefined);
        assertExists(parsed.id);
        assertEquals(parsed.decision_type, "reminder");
        decisionIds.push(parsed.id);
      });

      // ---- update_decision ----

      await t.step("update_decision corrects a decision", async () => {
        const targetId = decisionIds[0]; // classification decision
        const { parsed, isError } = await callTool("update_decision", {
          decision_id: targetId,
          review_status: "corrected",
          corrected_value: { category: "Plumbing" },
          corrected_by: testUserId,
        });

        assertEquals(isError, undefined);
        assertEquals(parsed.review_status, "corrected");
        assertEquals(parsed.corrected_value.category, "Plumbing");
        assertExists(parsed.corrected_at);
      });

      // ---- update_decision: value patching ----

      await t.step(
        "update_decision shallow-merges value without changing review_status",
        async () => {
          const reminderId = decisionIds[3]; // reminder decision

          // Update only due_at via value patch
          const { parsed, isError } = await callTool("update_decision", {
            decision_id: reminderId,
            value: { due_at: "2026-05-01T10:00:00Z" },
          });

          assertEquals(isError, undefined);
          // due_at should be updated
          assertEquals(parsed.value.due_at, "2026-05-01T10:00:00Z");
          // description should be preserved (shallow merge)
          assertEquals(parsed.value.description, "Call the plumber");
          // review_status should remain unchanged (pending)
          assertEquals(parsed.review_status, "pending");
        }
      );

      await t.step(
        "update_decision value patch works alongside correction fields",
        async () => {
          const reminderId = decisionIds[3]; // reminder decision

          // Provide both value patch and correction
          const { parsed, isError } = await callTool("update_decision", {
            decision_id: reminderId,
            value: { due_at: "2026-06-01T08:00:00Z" },
            review_status: "corrected",
            corrected_value: {
              due_at: "2026-07-01T08:00:00Z",
              description: "Call the plumber ASAP",
            },
            corrected_by: testUserId,
          });

          assertEquals(isError, undefined);
          // value column should have the patched due_at
          assertEquals(parsed.value.due_at, "2026-06-01T08:00:00Z");
          // description preserved in value
          assertEquals(parsed.value.description, "Call the plumber");
          // correction fields set independently
          assertEquals(parsed.review_status, "corrected");
          assertEquals(parsed.corrected_value.due_at, "2026-07-01T08:00:00Z");
          assertEquals(
            parsed.corrected_value.description,
            "Call the plumber ASAP"
          );
          assertExists(parsed.corrected_at);
        }
      );

      // ---- list_decisions ----

      await t.step("list_decisions filters by type and status", async () => {
        const { parsed: corrected } = await callTool("list_decisions", {
          thought_id: thoughtId,
          review_status: "corrected",
        });
        assertEquals(corrected.length, 2);
        const correctedTypes = corrected
          .map((d: { decision_type: string }) => d.decision_type)
          .sort();
        assertEquals(correctedTypes, ["classification", "reminder"]);

        const { parsed: reminders } = await callTool("list_decisions", {
          thought_id: thoughtId,
          decision_type: "reminder",
        });
        assertEquals(reminders.length, 1);
      });

      // ---- create_group ----

      await t.step("create_group creates group with members", async () => {
        const { parsed, isError } = await callTool("create_group", {
          name: "Home Issues",
          description: "Things to fix around the house",
          thought_ids: [thoughtId],
        });

        assertEquals(isError, undefined);
        assertExists(parsed.group_id);
        createdIds.groups.push(parsed.group_id);

        // Verify membership
        const { data: members } = await supabase
          .from("thought_group_members")
          .select("thought_id")
          .eq("group_id", parsed.group_id);
        assertEquals(members!.length, 1);
        assertEquals(members![0].thought_id, thoughtId);
      });

      // ---- create_notification ----

      await t.step("create_notification creates a notification", async () => {
        const { parsed, isError } = await callTool("create_notification", {
          user_id: testUserId,
          type: "reminder",
          title: "Plumber reminder",
          body: "Don't forget to call the plumber about the kitchen sink",
          thought_id: thoughtId,
          decision_id: decisionIds[3], // reminder decision
        });

        assertEquals(isError, undefined);
        assertExists(parsed.id);
        assertEquals(parsed.type, "reminder");
        createdIds.notifications.push(parsed.id);
      });

      // ---- set_session_title ----

      await t.step("set_session_title updates session title", async () => {
        const { parsed, isError } = await callTool("set_session_title", {
          session_id: testSessionId,
          title: "Home maintenance discussion",
        });

        assertEquals(isError, undefined);
        assertEquals(parsed.title, "Home maintenance discussion");

        // Verify in database
        const { data } = await supabase
          .from("chat_sessions")
          .select("title")
          .eq("id", testSessionId)
          .single();
        assertEquals(data!.title, "Home maintenance discussion");
      });

      // ---- Validation error ----

      await t.step(
        "tools/call returns validation error for bad input",
        async () => {
          const { parsed, isError } = await callTool("capture_thought", {
            content: 123, // should be string
          });

          assertEquals(isError, true);
          assertExists(parsed.error);
        }
      );

      // ---- Unknown tool ----

      await t.step("tools/call returns error for unknown tool", async () => {
        const res = await mcpRequest("tools/call", {
          name: "nonexistent_tool",
          arguments: {},
        });
        const json = await res.json();
        assertExists(json.error);
        assertEquals(json.error.code, -32602);
      });
    } finally {
      await teardown();
    }
  },
});
