import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));

import { checkReminders } from "../scheduler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSupabase(config: {
  rpcResult?: { data: unknown; error: unknown };
  decisionsResult?: { data: unknown; error: unknown };
  notificationsSelectResult?: { data: unknown; error: unknown };
  insertFn?: ReturnType<typeof vi.fn>;
}) {
  const insertFn = config.insertFn ?? vi.fn(async () => ({ error: null }));

  return {
    rpc: vi.fn(async () => config.rpcResult ?? { data: [], error: null }),
    from: vi.fn((table: string) => {
      if (table === "thought_decisions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              lte: vi.fn(
                () => config.decisionsResult ?? { data: [], error: null }
              ),
            })),
          })),
        };
      }
      if (table === "notifications") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(
              () =>
                config.notificationsSelectResult ?? { data: [], error: null }
            ),
          })),
          insert: insertFn,
        };
      }
      return { select: vi.fn(), insert: insertFn };
    }),
  } as unknown as Parameters<typeof checkReminders>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates notifications for due reminders via RPC", async () => {
    const insertFn = vi.fn(async () => ({ error: null }));

    const supabase = createMockSupabase({
      rpcResult: {
        data: [
          {
            decision_id: "dec-1",
            thought_id: "thought-1",
            thought_content: "Call the dentist",
            user_id: "user-1",
            description: "Dentist appointment follow-up",
            due_at: "2026-03-25T09:00:00Z",
          },
        ],
        error: null,
      },
      insertFn,
    });

    const count = await checkReminders(supabase);

    expect(count).toBe(1);
    expect(supabase.rpc).toHaveBeenCalledWith("get_due_reminders");
    expect(insertFn).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: "user-1",
        type: "reminder",
        title: "Reminder: Dentist appointment follow-up",
        thought_id: "thought-1",
        decision_id: "dec-1",
      }),
    ]);
  });

  it("creates no notifications when no reminders are due", async () => {
    const insertFn = vi.fn();
    const supabase = createMockSupabase({
      rpcResult: { data: [], error: null },
      insertFn,
    });

    const count = await checkReminders(supabase);

    expect(count).toBe(0);
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("creates notifications for multiple due reminders", async () => {
    const insertFn = vi.fn(async () => ({ error: null }));

    const supabase = createMockSupabase({
      rpcResult: {
        data: [
          {
            decision_id: "dec-1",
            thought_id: "thought-1",
            thought_content: "Call the dentist",
            user_id: "user-1",
            description: "Dentist appointment",
            due_at: "2026-03-25T09:00:00Z",
          },
          {
            decision_id: "dec-2",
            thought_id: "thought-2",
            thought_content: "Pay rent",
            user_id: "user-1",
            description: "Rent payment due",
            due_at: "2026-03-25T10:00:00Z",
          },
        ],
        error: null,
      },
      insertFn,
    });

    const count = await checkReminders(supabase);

    expect(count).toBe(2);
    expect(insertFn).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ decision_id: "dec-1" }),
        expect.objectContaining({ decision_id: "dec-2" }),
      ])
    );
  });

  it("falls back to manual query when RPC is unavailable", async () => {
    const insertFn = vi.fn(async () => ({ error: null }));
    const pastDate = new Date(Date.now() - 3600_000).toISOString();

    const supabase = createMockSupabase({
      rpcResult: { data: null, error: { message: "function not found" } },
      decisionsResult: {
        data: [
          {
            id: "dec-1",
            thought_id: "thought-1",
            value: { due_at: pastDate, description: "Overdue task" },
            corrected_value: null,
            review_status: "pending",
            thoughts: {
              id: "thought-1",
              content: "Do something important",
              created_by: "user-1",
            },
          },
        ],
        error: null,
      },
      notificationsSelectResult: { data: [], error: null },
      insertFn,
    });

    const count = await checkReminders(supabase);

    expect(count).toBe(1);
    expect(insertFn).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: "user-1",
        type: "reminder",
        title: "Reminder: Overdue task",
        decision_id: "dec-1",
      }),
    ]);
  });

  it("skips reminders that already have notifications (fallback path)", async () => {
    const insertFn = vi.fn(async () => ({ error: null }));
    const pastDate = new Date(Date.now() - 3600_000).toISOString();

    const supabase = createMockSupabase({
      rpcResult: { data: null, error: { message: "function not found" } },
      decisionsResult: {
        data: [
          {
            id: "dec-1",
            thought_id: "thought-1",
            value: { due_at: pastDate, description: "Already notified" },
            corrected_value: null,
            review_status: "pending",
            thoughts: {
              id: "thought-1",
              content: "Something",
              created_by: "user-1",
            },
          },
        ],
        error: null,
      },
      notificationsSelectResult: {
        data: [{ decision_id: "dec-1" }],
        error: null,
      },
      insertFn,
    });

    const count = await checkReminders(supabase);

    expect(count).toBe(0);
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("uses corrected_value when decision is corrected (fallback path)", async () => {
    const insertFn = vi.fn(async () => ({ error: null }));
    const pastDate = new Date(Date.now() - 3600_000).toISOString();

    const supabase = createMockSupabase({
      rpcResult: { data: null, error: { message: "function not found" } },
      decisionsResult: {
        data: [
          {
            id: "dec-1",
            thought_id: "thought-1",
            value: {
              due_at: "2099-01-01T00:00:00Z",
              description: "Original description",
            },
            corrected_value: {
              due_at: pastDate,
              description: "Corrected description",
            },
            review_status: "corrected",
            thoughts: {
              id: "thought-1",
              content: "Something",
              created_by: "user-1",
            },
          },
        ],
        error: null,
      },
      notificationsSelectResult: { data: [], error: null },
      insertFn,
    });

    const count = await checkReminders(supabase);

    expect(count).toBe(1);
    expect(insertFn).toHaveBeenCalledWith([
      expect.objectContaining({
        title: "Reminder: Corrected description",
      }),
    ]);
  });

  it("returns 0 when insert fails", async () => {
    const insertFn = vi.fn(async () => ({
      error: { message: "insert failed" },
    }));

    const supabase = createMockSupabase({
      rpcResult: {
        data: [
          {
            decision_id: "dec-1",
            thought_id: "thought-1",
            thought_content: "Something",
            user_id: "user-1",
            description: "Test",
            due_at: "2026-03-25T09:00:00Z",
          },
        ],
        error: null,
      },
      insertFn,
    });

    const count = await checkReminders(supabase);
    expect(count).toBe(0);
  });
});
