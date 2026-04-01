import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sendMessage, waitForAssistantReply, queryDb } from "./helpers.js";

// Read the test user ID saved by global-setup
const testUserPath = resolve(import.meta.dirname, ".test-user.json");

function getTestUserId(): string {
  const raw = readFileSync(testUserPath, "utf-8");
  return JSON.parse(raw).userId;
}

test("capture a thought — creates thought and decisions in the database", async ({
  page,
}) => {
  const userId = getTestUserId();

  // Navigate to the app (already authenticated via storageState)
  await page.goto("/");
  await page
    .locator('[data-testid="chat-input"]')
    .waitFor({ state: "visible" });

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
