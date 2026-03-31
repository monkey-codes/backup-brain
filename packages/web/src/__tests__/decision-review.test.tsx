import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before importing components
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockOr = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getSession: () =>
        Promise.resolve({
          data: {
            session: {
              user: { id: "user-1", email: "test@example.com" },
              access_token: "token",
            },
          },
        }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));

import { DecisionReviewView } from "../views/decision-review";
import { AuthProvider } from "../hooks/use-auth";

const MOCK_DECISIONS = [
  {
    id: "dec-1",
    thought_id: "thought-1",
    decision_type: "classification",
    value: { category: "Home Maintenance" },
    confidence: 0.5,
    reasoning: "Mentioned fixing the roof",
    review_status: "pending",
    corrected_value: null,
    corrected_by: null,
    corrected_at: null,
    created_at: "2026-03-26T10:00:00Z",
    thought: { id: "thought-1", content: "Need to fix the roof before winter" },
  },
  {
    id: "dec-2",
    thought_id: "thought-2",
    decision_type: "tag",
    value: { label: "urgent" },
    confidence: 0.9,
    reasoning: "User said ASAP",
    review_status: "accepted",
    corrected_value: null,
    corrected_by: null,
    corrected_at: null,
    created_at: "2026-03-26T09:00:00Z",
    thought: { id: "thought-2", content: "Call the plumber ASAP" },
  },
  {
    id: "dec-3",
    thought_id: "thought-3",
    decision_type: "entity",
    value: { name: "Bob", type: "person" },
    confidence: 0.3,
    reasoning: "Mentioned someone named Bob",
    review_status: "pending",
    corrected_value: null,
    corrected_by: null,
    corrected_at: null,
    created_at: "2026-03-26T08:00:00Z",
    thought: { id: "thought-3", content: "Bob said he'd help with the move" },
  },
];

function setupSupabaseMock(decisions = MOCK_DECISIONS) {
  mockOrder.mockResolvedValue({ data: decisions, error: null });
  mockOr.mockReturnValue({ order: mockOrder });
  mockSelect.mockReturnValue({ or: mockOr, order: mockOrder });
  mockFrom.mockImplementation((table: string) => {
    if (table === "thought_decisions") {
      return { select: mockSelect, update: mockUpdate };
    }
    return { select: vi.fn(), update: vi.fn() };
  });
}

function renderReview(onBack = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DecisionReviewView onBack={onBack} />
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("DecisionReviewView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders decision cards with thought content", async () => {
    setupSupabaseMock();
    renderReview();

    await waitFor(() => {
      expect(
        screen.getByText("Need to fix the roof before winter")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("Bob said he'd help with the move")
    ).toBeInTheDocument();
  });

  it("shows decision type, value, confidence, and status badges", async () => {
    setupSupabaseMock();
    renderReview();

    await waitFor(() => {
      expect(screen.getAllByTestId("decision-card")).toHaveLength(3);
    });

    // Check confidence badges
    const badges = screen.getAllByTestId("confidence-badge");
    expect(badges[0]).toHaveTextContent("50%");
    expect(badges[1]).toHaveTextContent("90%");
    expect(badges[2]).toHaveTextContent("30%");

    // Check status badges
    const statusBadges = screen.getAllByTestId("status-badge");
    expect(statusBadges[0]).toHaveTextContent("pending");
    expect(statusBadges[1]).toHaveTextContent("accepted");
  });

  it("defaults to needs_review filter", async () => {
    setupSupabaseMock();
    renderReview();

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("thought_decisions");
    });

    // The needs_review filter should apply .or()
    expect(mockOr).toHaveBeenCalledWith(
      "review_status.eq.pending,confidence.lt.0.7"
    );
  });

  it("switches to all filter", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId("filter-all")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("filter-all"));

    // After clicking "All", query should not use .or() filter
    // It calls select().order() directly
    await waitFor(() => {
      // The second call should be for "all" filter
      const calls = mockFrom.mock.calls.filter(
        (c: string[]) => c[0] === "thought_decisions"
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows accept and correct buttons only for pending decisions", async () => {
    setupSupabaseMock();
    renderReview();

    await waitFor(() => {
      expect(screen.getAllByTestId("decision-card")).toHaveLength(3);
    });

    const cards = screen.getAllByTestId("decision-card");

    // First card (pending) should have buttons
    expect(within(cards[0]).getByTestId("accept-button")).toBeInTheDocument();
    expect(within(cards[0]).getByTestId("correct-button")).toBeInTheDocument();

    // Second card (accepted) should NOT have buttons
    expect(
      within(cards[1]).queryByTestId("accept-button")
    ).not.toBeInTheDocument();

    // Third card (pending) should have buttons
    expect(within(cards[2]).getByTestId("accept-button")).toBeInTheDocument();
  });

  it("accepts a decision", async () => {
    setupSupabaseMock();
    const updatedDecision = {
      ...MOCK_DECISIONS[0],
      review_status: "accepted",
    };
    mockSingle.mockResolvedValue({ data: updatedDecision, error: null });
    mockEq.mockReturnValue({ select: () => ({ single: mockSingle }) });
    mockUpdate.mockReturnValue({ eq: mockEq });

    const user = userEvent.setup();
    renderReview();

    await waitFor(() => {
      expect(screen.getAllByTestId("accept-button")).toHaveLength(2);
    });

    await user.click(screen.getAllByTestId("accept-button")[0]);

    expect(mockUpdate).toHaveBeenCalledWith({
      review_status: "accepted",
    });
    expect(mockEq).toHaveBeenCalledWith("id", "dec-1");
  });

  it("opens correction form and submits corrected value", async () => {
    setupSupabaseMock();
    const updatedDecision = {
      ...MOCK_DECISIONS[0],
      review_status: "corrected",
      corrected_value: { category: "Vehicles" },
    };
    mockSingle.mockResolvedValue({ data: updatedDecision, error: null });
    mockEq.mockReturnValue({ select: () => ({ single: mockSingle }) });
    mockUpdate.mockReturnValue({ eq: mockEq });

    const user = userEvent.setup();
    renderReview();

    await waitFor(() => {
      expect(screen.getAllByTestId("correct-button")).toHaveLength(2);
    });

    // Click correct on first card
    await user.click(screen.getAllByTestId("correct-button")[0]);

    // Correction form should appear
    const form = screen.getByTestId("correction-form");
    expect(form).toBeInTheDocument();

    // Edit the category input
    const input = screen.getByTestId("correction-input-category");
    await user.clear(input);
    await user.type(input, "Vehicles");

    // Submit
    await user.click(screen.getByTestId("correction-submit"));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        review_status: "corrected",
        corrected_value: { category: "Vehicles" },
        corrected_by: "user-1",
      })
    );
  });

  it("shows empty state when no decisions need review", async () => {
    setupSupabaseMock([]);
    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
    expect(screen.getByText("No decisions need review")).toBeInTheDocument();
  });

  it("navigates back when back button is clicked", async () => {
    setupSupabaseMock();
    const onBack = vi.fn();
    const user = userEvent.setup();
    renderReview(onBack);

    await waitFor(() => {
      expect(screen.getByTestId("back-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("back-button"));
    expect(onBack).toHaveBeenCalled();
  });
});
