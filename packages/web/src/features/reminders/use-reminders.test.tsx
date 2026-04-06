import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockLt = vi.fn();

vi.mock("@/shared/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { useReminders } from "./use-reminders";

const MOCK_REMINDERS = [
  {
    id: "dec-1",
    thought_id: "thought-1",
    decision_type: "reminder",
    value: { due_at: "2026-04-10T09:00:00Z", description: "Dentist" },
    confidence: 0.9,
    reasoning: "test",
    review_status: "pending",
    corrected_value: null,
    corrected_by: null,
    corrected_at: null,
    created_at: "2026-04-01T00:00:00Z",
  },
  {
    id: "dec-2",
    thought_id: "thought-2",
    decision_type: "reminder",
    value: { due_at: "2026-04-10T14:00:00Z", description: "Gym" },
    confidence: 0.8,
    reasoning: "test",
    review_status: "accepted",
    corrected_value: null,
    corrected_by: null,
    corrected_at: null,
    created_at: "2026-04-01T00:00:00Z",
  },
  {
    id: "dec-3",
    thought_id: "thought-3",
    decision_type: "reminder",
    value: { due_at: "2026-04-15T10:00:00Z", description: "Original meeting" },
    confidence: 0.7,
    reasoning: "test",
    review_status: "corrected",
    corrected_value: {
      due_at: "2026-04-20T10:00:00Z",
      description: "Corrected meeting",
    },
    corrected_by: "user-1",
    corrected_at: "2026-04-02T00:00:00Z",
    created_at: "2026-04-01T00:00:00Z",
  },
];

function setupSupabaseMock(data = MOCK_REMINDERS) {
  mockLt.mockResolvedValue({ data, error: null });
  mockGte.mockReturnValue({ lt: mockLt });
  mockEq.mockReturnValue({ gte: mockGte });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockFrom.mockReturnValue({ select: mockSelect });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries thought_decisions with correct filters for year/month", async () => {
    setupSupabaseMock();

    renderHook(() => useReminders(2026, 4), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("thought_decisions");
    });
    expect(mockSelect).toHaveBeenCalledWith("*");
    expect(mockEq).toHaveBeenCalledWith("decision_type", "reminder");
    // April 2026: gte start of month, lt start of next month
    expect(mockGte).toHaveBeenCalledWith(
      "value->>due_at",
      "2026-04-01T00:00:00.000Z"
    );
    expect(mockLt).toHaveBeenCalledWith(
      "value->>due_at",
      "2026-05-01T00:00:00.000Z"
    );
  });

  it("uses value when review_status is pending", async () => {
    setupSupabaseMock([MOCK_REMINDERS[0]]);

    const { result } = renderHook(() => useReminders(2026, 4), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    const reminders = result.current.data!;
    const dayReminders = reminders["2026-04-10"];
    expect(dayReminders).toHaveLength(1);
    expect(dayReminders[0].description).toBe("Dentist");
    expect(dayReminders[0].due_at).toBe("2026-04-10T09:00:00Z");
    expect(dayReminders[0].review_status).toBe("pending");
  });

  it("uses value when review_status is accepted", async () => {
    setupSupabaseMock([MOCK_REMINDERS[1]]);

    const { result } = renderHook(() => useReminders(2026, 4), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    const reminders = result.current.data!;
    const dayReminders = reminders["2026-04-10"];
    expect(dayReminders).toHaveLength(1);
    expect(dayReminders[0].description).toBe("Gym");
    expect(dayReminders[0].review_status).toBe("accepted");
  });

  it("uses corrected_value when review_status is corrected", async () => {
    setupSupabaseMock([MOCK_REMINDERS[2]]);

    const { result } = renderHook(() => useReminders(2026, 4), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    const reminders = result.current.data!;
    // Corrected to April 20, not the original April 15
    expect(reminders["2026-04-15"]).toBeUndefined();
    const dayReminders = reminders["2026-04-20"];
    expect(dayReminders).toHaveLength(1);
    expect(dayReminders[0].description).toBe("Corrected meeting");
    expect(dayReminders[0].due_at).toBe("2026-04-20T10:00:00Z");
    expect(dayReminders[0].review_status).toBe("corrected");
  });

  it("groups reminders by day", async () => {
    setupSupabaseMock();

    const { result } = renderHook(() => useReminders(2026, 4), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    const reminders = result.current.data!;
    // dec-1 and dec-2 both on April 10
    expect(reminders["2026-04-10"]).toHaveLength(2);
    // dec-3 corrected to April 20
    expect(reminders["2026-04-20"]).toHaveLength(1);
  });

  it("includes id and review_status in each reminder", async () => {
    setupSupabaseMock([MOCK_REMINDERS[0]]);

    const { result } = renderHook(() => useReminders(2026, 4), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    const reminder = result.current.data!["2026-04-10"][0];
    expect(reminder.id).toBe("dec-1");
    expect(reminder.review_status).toBe("pending");
  });

  it("returns empty object when no reminders exist", async () => {
    setupSupabaseMock([]);

    const { result } = renderHook(() => useReminders(2026, 4), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toEqual({});
  });

  it("uses correct query key for cache isolation", async () => {
    setupSupabaseMock();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    renderHook(() => useReminders(2026, 4), { wrapper });

    await waitFor(() => {
      expect(result()).toBeDefined();
    });

    function result() {
      return queryClient.getQueryData(["reminders", 2026, 4]);
    }
  });
});
