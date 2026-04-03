import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  sendMessage,
  waitForAssistantReply,
  navigateAndStartChat,
  createNewSession,
  queryDb,
  cleanupUserData,
} from "./helpers.js";

// Read the test user ID saved by global-setup
const testUserPath = resolve(import.meta.dirname, ".test-user.json");

function getTestUserId(): string {
  const raw = readFileSync(testUserPath, "utf-8");
  return JSON.parse(raw).userId;
}

// Clean up all user data between tests to ensure isolation
test.beforeEach(async () => {
  const userId = getTestUserId();
  await cleanupUserData(userId);
});

test("capture a thought — creates thought and decisions in the database", async ({
  page,
}) => {
  const userId = getTestUserId();

  // Navigate to the app and start a new chat session
  await navigateAndStartChat(page);

  // Send a natural language message
  const message = "I need to fix the leaky faucet in the kitchen";
  await sendMessage(page, message);

  // Wait for the agent to reply in the UI
  await waitForAssistantReply(page);

  // Assert: a thoughts row was created by this user
  const thoughts = await queryDb<{
    id: string;
    content: string;
    created_by: string;
  }>("thoughts", { created_by: userId });

  expect(thoughts.length).toBeGreaterThanOrEqual(1);

  // Find the thought matching our message (content may be paraphrased,
  // but should contain key terms)
  const thought = thoughts.find(
    (t) => t.content.includes("faucet") || t.content.includes("kitchen")
  );
  expect(thought).toBeDefined();

  // Assert: thought_decisions rows exist for this thought
  const decisions = await queryDb<{
    id: string;
    thought_id: string;
    decision_type: string;
    value: Record<string, unknown>;
    confidence: number;
  }>("thought_decisions", { thought_id: thought!.id });

  expect(decisions.length).toBeGreaterThanOrEqual(1);

  // Assert: structural checks on decision types
  const decisionTypes = decisions.map((d) => d.decision_type);

  // Should have at least a classification decision
  expect(decisionTypes).toContain("classification");

  // Each decision should have required fields
  for (const decision of decisions) {
    expect(decision.value).toBeDefined();
    expect(typeof decision.confidence).toBe("number");
    expect(decision.confidence).toBeGreaterThanOrEqual(0);
    expect(decision.confidence).toBeLessThanOrEqual(1);
  }

  // Classification decision should have a category field
  const classification = decisions.find(
    (d) => d.decision_type === "classification"
  );
  expect(classification).toBeDefined();
  expect(classification!.value).toHaveProperty("category");
  expect(typeof classification!.value.category).toBe("string");
});

test("capture a reminder — creates reminder decision with due_at and description", async ({
  page,
}) => {
  const userId = getTestUserId();

  // Navigate to the app and start a new chat session
  await navigateAndStartChat(page);

  // Send a message with a time reference
  const message = "Remind me to call the plumber tomorrow at 9am";
  await sendMessage(page, message);

  // Wait for the agent to reply in the UI
  await waitForAssistantReply(page);

  // Assert: a thoughts row was created by this user containing reminder content
  const thoughts = await queryDb<{
    id: string;
    content: string;
    created_by: string;
  }>("thoughts", { created_by: userId });

  const thought = thoughts.find(
    (t) => t.content.includes("plumber") || t.content.includes("call")
  );
  expect(thought).toBeDefined();

  // Assert: a thought_decisions row with decision_type = 'reminder' exists
  const decisions = await queryDb<{
    id: string;
    thought_id: string;
    decision_type: string;
    value: Record<string, unknown>;
  }>("thought_decisions", {
    thought_id: thought!.id,
    decision_type: "reminder",
  });

  expect(decisions.length).toBeGreaterThanOrEqual(1);

  const reminder = decisions[0];

  // Assert: value contains due_at (a date string) and description (a string)
  expect(reminder.value).toHaveProperty("due_at");
  expect(typeof reminder.value.due_at).toBe("string");
  // due_at should be parseable as a date
  expect(new Date(reminder.value.due_at as string).toString()).not.toBe(
    "Invalid Date"
  );

  expect(reminder.value).toHaveProperty("description");
  expect(typeof reminder.value.description).toBe("string");
  expect((reminder.value.description as string).length).toBeGreaterThan(0);
});

test("update a reminder cross-session — reschedule changes due_at in the database", async ({
  page,
}) => {
  const userId = getTestUserId();

  // --- Session A: capture a reminder ---
  await navigateAndStartChat(page);

  const message = "Remind me to call the plumber tomorrow at 9am";
  await sendMessage(page, message);
  await waitForAssistantReply(page);

  // Find the thought with reminder content
  const thoughts = await queryDb<{
    id: string;
    content: string;
    created_by: string;
  }>("thoughts", { created_by: userId });

  const thought = thoughts.find(
    (t) => t.content.includes("plumber") || t.content.includes("call")
  );
  expect(thought).toBeDefined();

  // Get the original reminder decision and its due_at
  const originalDecisions = await queryDb<{
    id: string;
    thought_id: string;
    decision_type: string;
    value: Record<string, unknown>;
  }>("thought_decisions", {
    thought_id: thought!.id,
    decision_type: "reminder",
  });

  expect(originalDecisions.length).toBeGreaterThanOrEqual(1);
  const originalDueAt = originalDecisions[0].value.due_at as string;
  expect(originalDueAt).toBeDefined();
  const decisionId = originalDecisions[0].id;

  // --- Session B: reschedule the reminder (no prior chat context) ---
  await createNewSession(page);

  const rescheduleMessage =
    "Actually, move the plumber reminder to next week same time";
  await sendMessage(page, rescheduleMessage);
  await waitForAssistantReply(page);

  // Assert: the reminder decision's due_at has changed
  const updatedDecisions = await queryDb<{
    id: string;
    thought_id: string;
    decision_type: string;
    value: Record<string, unknown>;
  }>("thought_decisions", {
    id: decisionId,
  });

  expect(updatedDecisions.length).toBe(1);
  const updatedDueAt = updatedDecisions[0].value.due_at as string;
  expect(updatedDueAt).toBeDefined();
  expect(new Date(updatedDueAt).toString()).not.toBe("Invalid Date");
  expect(updatedDueAt).not.toBe(originalDueAt);
});

test("complete a todo cross-session — sets completed_at via value merge", async ({
  page,
}) => {
  const userId = getTestUserId();

  // --- Session A: capture a todo ---
  await navigateAndStartChat(page);

  const message = "Add a todo to paint the fence";
  await sendMessage(page, message);
  await waitForAssistantReply(page);

  // Find the thought with todo content
  const thoughts = await queryDb<{
    id: string;
    content: string;
    created_by: string;
  }>("thoughts", { created_by: userId });

  const thought = thoughts.find(
    (t) => t.content.includes("paint") || t.content.includes("fence")
  );
  expect(thought).toBeDefined();

  // Get the todo decision and verify it has completed_at: null
  const originalDecisions = await queryDb<{
    id: string;
    thought_id: string;
    decision_type: string;
    value: Record<string, unknown>;
    review_status: string;
  }>("thought_decisions", {
    thought_id: thought!.id,
    decision_type: "todo",
  });

  expect(originalDecisions.length).toBeGreaterThanOrEqual(1);
  expect(originalDecisions[0].value.completed_at).toBeNull();
  const decisionId = originalDecisions[0].id;
  const originalReviewStatus = originalDecisions[0].review_status;

  // --- Session B: complete the todo (no prior chat context) ---
  await createNewSession(page);

  const completionMessage = "I painted the fence";
  await sendMessage(page, completionMessage);
  await waitForAssistantReply(page);

  // Assert: the todo decision's completed_at is now set
  const updatedDecisions = await queryDb<{
    id: string;
    decision_type: string;
    value: Record<string, unknown>;
    review_status: string;
    corrected_value: Record<string, unknown> | null;
  }>("thought_decisions", {
    id: decisionId,
  });

  expect(updatedDecisions.length).toBe(1);
  const updatedValue = updatedDecisions[0].value;
  expect(updatedValue.completed_at).toBeDefined();
  expect(updatedValue.completed_at).not.toBeNull();
  // completed_at should be a parseable date
  expect(new Date(updatedValue.completed_at as string).toString()).not.toBe(
    "Invalid Date"
  );
  // description should still be present (shallow merge preserves it)
  expect(updatedValue.description).toBeDefined();
  // review_status should NOT change — completion is not a correction
  expect(updatedDecisions[0].review_status).toBe(originalReviewStatus);
});

test("correct a decision cross-session — sets review_status and corrected_value", async ({
  page,
}) => {
  const userId = getTestUserId();

  // --- Session A: capture a thought ---
  await navigateAndStartChat(page);

  const message = "I need to fix the leaky faucet in the kitchen";
  await sendMessage(page, message);
  await waitForAssistantReply(page);

  // Find the thought
  const thoughts = await queryDb<{
    id: string;
    content: string;
    created_by: string;
  }>("thoughts", { created_by: userId });

  const thought = thoughts.find(
    (t) => t.content.includes("faucet") || t.content.includes("kitchen")
  );
  expect(thought).toBeDefined();

  // Get the classification decision
  const decisions = await queryDb<{
    id: string;
    thought_id: string;
    decision_type: string;
    value: Record<string, unknown>;
    review_status: string;
  }>("thought_decisions", {
    thought_id: thought!.id,
    decision_type: "classification",
  });

  expect(decisions.length).toBeGreaterThanOrEqual(1);
  const classificationId = decisions[0].id;
  const originalCategory = decisions[0].value.category as string;
  expect(originalCategory).toBeDefined();

  // --- Session B: correct the decision (no prior chat context) ---
  await createNewSession(page);

  const correctionMessage = `No, you classified the thought about the faucet wrong. It should be in the Plumbing category, not Home Maintenance`;
  await sendMessage(page, correctionMessage);
  await waitForAssistantReply(page);

  // Assert: the classification decision has review_status = 'corrected' and corrected_value is set
  const updatedDecisions = await queryDb<{
    id: string;
    decision_type: string;
    review_status: string;
    corrected_value: Record<string, unknown> | null;
  }>("thought_decisions", {
    id: classificationId,
  });

  expect(updatedDecisions.length).toBe(1);
  expect(updatedDecisions[0].review_status).toBe("corrected");
  expect(updatedDecisions[0].corrected_value).toBeDefined();
  expect(updatedDecisions[0].corrected_value).not.toBeNull();
});
