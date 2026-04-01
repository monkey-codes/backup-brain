import { chromium, type FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const STORAGE_STATE_PATH = resolve(import.meta.dirname, "storage-state.json");
const TEST_USER_PATH = resolve(import.meta.dirname, ".test-user.json");

const TEST_EMAIL = `e2e-test-${Date.now()}@test.local`;
const TEST_PASSWORD = "test-password-e2e-123";

export default async function globalSetup(config: FullConfig) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment"
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Create test user via admin API
  const { data: userData, error: createErr } =
    await supabase.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });

  if (createErr) {
    throw new Error(`Failed to create test user: ${createErr.message}`);
  }

  const userId = userData.user!.id;

  // Save user ID for teardown
  writeFileSync(TEST_USER_PATH, JSON.stringify({ userId, email: TEST_EMAIL }));

  // Launch browser, log in via the UI, and save storage state
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:5173";

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await page.goto("/login");
  await page.locator("#email").fill(TEST_EMAIL);
  await page.locator("#password").fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Wait for redirect to the authenticated app
  await page.waitForURL("/", { timeout: 15_000 });

  // Save authenticated browser state (localStorage session)
  await context.storageState({ path: STORAGE_STATE_PATH });

  await browser.close();
}
