import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { RemindersView } from "./reminders";

function setupSupabaseMock(data: Record<string, unknown>[] = []) {
  mockLt.mockResolvedValue({ data, error: null });
  mockGte.mockReturnValue({ lt: mockLt });
  mockEq.mockReturnValue({ gte: mockGte });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockFrom.mockReturnValue({ select: mockSelect });
}

function renderReminders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  return {
    user,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RemindersView />
        </MemoryRouter>
      </QueryClientProvider>
    ),
  };
}

describe("RemindersView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the reminders page shell", () => {
    setupSupabaseMock();
    renderReminders();
    expect(screen.getByTestId("reminders-page")).toBeInTheDocument();
  });

  it("renders a header with the current month and year", () => {
    setupSupabaseMock();
    renderReminders();

    const now = new Date();
    const expectedHeader = now.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    expect(screen.getByTestId("reminders-header")).toHaveTextContent(
      expectedHeader
    );
  });

  it("renders the month grid by default", async () => {
    setupSupabaseMock();
    renderReminders();

    // Month grid renders synchronously - day cells are present immediately
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    expect(
      screen.getByTestId(`day-cell-${year}-${month}-01`)
    ).toBeInTheDocument();
  });

  it("navigates to previous month when prev button is clicked", async () => {
    setupSupabaseMock();
    const { user } = renderReminders();

    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1);
    const expectedHeader = prev.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    await user.click(screen.getByTestId("month-prev"));

    expect(screen.getByTestId("reminders-header")).toHaveTextContent(
      expectedHeader
    );
  });

  it("navigates to next month when next button is clicked", async () => {
    setupSupabaseMock();
    const { user } = renderReminders();

    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1);
    const expectedHeader = next.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    await user.click(screen.getByTestId("month-next"));

    expect(screen.getByTestId("reminders-header")).toHaveTextContent(
      expectedHeader
    );
  });

  it("resets to current month when Today button is clicked", async () => {
    setupSupabaseMock();
    const { user } = renderReminders();

    const now = new Date();
    const currentHeader = now.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    // Navigate away
    await user.click(screen.getByTestId("month-prev"));
    await user.click(screen.getByTestId("month-prev"));

    // Should not show current month
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2);
    expect(screen.getByTestId("reminders-header")).toHaveTextContent(
      twoMonthsAgo.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    );

    // Click Today
    await user.click(screen.getByTestId("month-today"));

    expect(screen.getByTestId("reminders-header")).toHaveTextContent(
      currentHeader
    );
  });

  it("switches to day detail when a day is clicked", async () => {
    setupSupabaseMock();
    const { user } = renderReminders();

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const dayCell = `day-cell-${year}-${month}-10`;

    await user.click(screen.getByTestId(dayCell));

    expect(screen.getByTestId("day-detail-header")).toBeInTheDocument();
  });

  it("returns to month grid when back button is clicked in day detail", async () => {
    setupSupabaseMock();
    const { user } = renderReminders();

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const dayCell = `day-cell-${year}-${month}-10`;

    // Go to day detail
    await user.click(screen.getByTestId(dayCell));
    expect(screen.getByTestId("day-detail-header")).toBeInTheDocument();

    // Click back
    await user.click(screen.getByTestId("day-detail-back"));

    // Month grid should be visible again
    expect(screen.getByTestId(dayCell)).toBeInTheDocument();
    expect(screen.queryByTestId("day-detail-header")).not.toBeInTheDocument();
  });

  it("passes reminder data to month grid as counts", async () => {
    // Use a fixed date key that matches current month
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const dateKey = `${year}-${month}-10`;

    setupSupabaseMock([
      {
        id: "r1",
        value: { due_at: `${dateKey}T09:00:00Z`, description: "Dentist" },
        review_status: "pending",
        corrected_value: null,
      },
      {
        id: "r2",
        value: { due_at: `${dateKey}T14:00:00Z`, description: "Meeting" },
        review_status: "accepted",
        corrected_value: null,
      },
    ]);
    renderReminders();

    await waitFor(() => {
      const cell = screen.getByTestId(`day-cell-${dateKey}`);
      const countBadge = cell.querySelector("[data-testid='reminder-count']");
      expect(countBadge).toHaveTextContent("2");
    });
  });

  it("passes reminder data to day detail for selected day", async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const dateKey = `${year}-${month}-10`;

    setupSupabaseMock([
      {
        id: "r1",
        value: { due_at: `${dateKey}T09:00:00Z`, description: "Dentist" },
        review_status: "pending",
        corrected_value: null,
      },
    ]);
    const { user } = renderReminders();

    // Wait for data to load
    await waitFor(() => {
      const cell = screen.getByTestId(`day-cell-${dateKey}`);
      expect(
        cell.querySelector("[data-testid='reminder-dot']")
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId(`day-cell-${dateKey}`));

    await waitFor(() => {
      expect(screen.getByText("Dentist")).toBeInTheDocument();
    });
  });
});
