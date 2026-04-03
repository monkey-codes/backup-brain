import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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

async function renderReview() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <MemoryRouter initialEntries={["/review"]}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <DecisionReviewView />
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  });
  return result!;
}

describe("DecisionReviewView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders decision cards with quoted thought content", async () => {
    setupSupabaseMock();
    await renderReview();

    await waitFor(() => {
      expect(
        screen.getByText("Need to fix the roof before winter")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("Bob said he'd help with the move")
    ).toBeInTheDocument();

    // Thought content is inside quoted context blocks
    const cards = screen.getAllByTestId("thought-content");
    expect(cards).toHaveLength(3);
  });

  it("shows confidence, status, and type badges on cards", async () => {
    setupSupabaseMock();
    await renderReview();

    await waitFor(() => {
      expect(screen.getAllByTestId("decision-card")).toHaveLength(3);
    });

    // Confidence badges with color-coded thresholds
    const badges = screen.getAllByTestId("confidence-badge");
    expect(badges[0]).toHaveTextContent("50%");
    expect(badges[1]).toHaveTextContent("90%");
    expect(badges[2]).toHaveTextContent("30%");

    // Status badges
    const statusBadges = screen.getAllByTestId("status-badge");
    expect(statusBadges[0]).toHaveTextContent("pending");
    expect(statusBadges[1]).toHaveTextContent("accepted");
  });

  it("renders cards with colored left borders by status", async () => {
    setupSupabaseMock();
    await renderReview();

    await waitFor(() => {
      expect(screen.getAllByTestId("decision-card")).toHaveLength(3);
    });

    const cards = screen.getAllByTestId("decision-card");
    // Pending cards have purple border, accepted have primary (blue) border
    expect(cards[0].className).toContain("border-l-purple-500");
    expect(cards[1].className).toContain("border-l-primary");
    expect(cards[2].className).toContain("border-l-purple-500");
  });

  it("defaults to needs_review filter via segmented control", async () => {
    setupSupabaseMock();
    await renderReview();

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("thought_decisions");
    });

    expect(mockOr).toHaveBeenCalledWith(
      "review_status.eq.pending,confidence.lt.0.7"
    );
  });

  it("switches to all filter via segmented control", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderReview();

    await waitFor(() => {
      expect(screen.getByTestId("filter-all")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("filter-all"));

    await waitFor(() => {
      const calls = mockFrom.mock.calls.filter(
        (c: string[]) => c[0] === "thought_decisions"
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows accept, correct, and discard buttons only for pending decisions", async () => {
    setupSupabaseMock();
    await renderReview();

    await waitFor(() => {
      expect(screen.getAllByTestId("decision-card")).toHaveLength(3);
    });

    const cards = screen.getAllByTestId("decision-card");

    // First card (pending) should have all action buttons
    expect(within(cards[0]).getByTestId("accept-button")).toBeInTheDocument();
    expect(within(cards[0]).getByTestId("correct-button")).toBeInTheDocument();
    expect(within(cards[0]).getByTestId("discard-button")).toBeInTheDocument();

    // Second card (accepted) should NOT have action buttons
    expect(
      within(cards[1]).queryByTestId("accept-button")
    ).not.toBeInTheDocument();

    // Third card (pending) should have action buttons
    expect(within(cards[2]).getByTestId("accept-button")).toBeInTheDocument();
  });

  it("accepts a decision with gradient primary button", async () => {
    setupSupabaseMock();
    const updatedDecision = {
      ...MOCK_DECISIONS[0],
      review_status: "accepted",
    };
    mockSingle.mockResolvedValue({ data: updatedDecision, error: null });
    mockEq.mockReturnValue({ select: () => ({ single: mockSingle }) });
    mockUpdate.mockReturnValue({ eq: mockEq });

    const user = userEvent.setup();
    await renderReview();

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
    await renderReview();

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

  it("decision list container has overflow-y-auto for scrolling", async () => {
    setupSupabaseMock();
    await renderReview();

    await waitFor(() => {
      expect(screen.getAllByTestId("decision-card")).toHaveLength(3);
    });

    // The scrollable list container should have overflow-y-auto
    const scrollContainer =
      screen.getAllByTestId("decision-card")[0].parentElement!.parentElement!;
    expect(scrollContainer.className).toContain("overflow-y-auto");
    expect(scrollContainer.className).toContain("flex-1");
  });

  it("view root is a flex column to enable flex-1 height chain", async () => {
    setupSupabaseMock();
    await renderReview();

    await waitFor(() => {
      expect(screen.getAllByTestId("decision-card")).toHaveLength(3);
    });

    // The DecisionReviewView root should be flex col so children can flex-1
    const scrollContainer =
      screen.getAllByTestId("decision-card")[0].parentElement!.parentElement!;
    const viewRoot = scrollContainer.parentElement!;
    expect(viewRoot.className).toContain("flex");
    expect(viewRoot.className).toContain("flex-col");
    expect(viewRoot.className).toContain("flex-1");
  });

  it("shows empty state when no decisions need review", async () => {
    setupSupabaseMock([]);
    await renderReview();

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
    expect(screen.getByText("No decisions need review")).toBeInTheDocument();
  });
});
