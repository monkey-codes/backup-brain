import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before importing components
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockIs = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockChannel = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: vi.fn(),
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

import { NotificationsView } from "../views/notifications";
import { AuthProvider } from "../hooks/use-auth";

const MOCK_NOTIFICATIONS = [
  {
    id: "notif-1",
    user_id: "user-1",
    type: "reminder",
    title: "Reminder: Dentist appointment",
    body: 'Due: 3/25/2026. From thought: "Call the dentist"',
    thought_id: "thought-1",
    decision_id: "dec-1",
    delivered_via: null,
    read_at: null,
    dismissed_at: null,
    created_at: "2026-03-26T10:00:00Z",
  },
  {
    id: "notif-2",
    user_id: "user-1",
    type: "insight",
    title: "Pattern detected: Home repairs",
    body: "You have 5 related thoughts about home maintenance",
    thought_id: null,
    decision_id: null,
    delivered_via: null,
    read_at: "2026-03-26T11:00:00Z",
    dismissed_at: null,
    created_at: "2026-03-26T09:00:00Z",
  },
  {
    id: "notif-3",
    user_id: "user-1",
    type: "suggestion",
    title: "Consider grouping vehicle thoughts",
    body: "You have several thoughts about car maintenance",
    thought_id: null,
    decision_id: null,
    delivered_via: null,
    read_at: null,
    dismissed_at: null,
    created_at: "2026-03-26T08:00:00Z",
  },
];

function setupSupabaseMock(notifications = MOCK_NOTIFICATIONS) {
  mockOrder.mockResolvedValue({ data: notifications, error: null });
  mockIs.mockReturnValue({ order: mockOrder });
  mockSelect.mockReturnValue({ is: mockIs, order: mockOrder });
  mockFrom.mockImplementation((table: string) => {
    if (table === "notifications") {
      return { select: mockSelect, update: mockUpdate };
    }
    return { select: vi.fn(), update: vi.fn() };
  });

  // Mock channel for realtime subscription
  mockChannel.mockReturnValue({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn(),
  });
}

async function renderNotifications() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <MemoryRouter initialEntries={["/notifications"]}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <NotificationsView />
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  });
  return result!;
}

describe("NotificationsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders notification cards", async () => {
    setupSupabaseMock();
    await renderNotifications();

    await waitFor(() => {
      expect(
        screen.getByText("Reminder: Dentist appointment")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("Pattern detected: Home repairs")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Consider grouping vehicle thoughts")
    ).toBeInTheDocument();
  });

  it("shows notification type badges", async () => {
    setupSupabaseMock();
    await renderNotifications();

    await waitFor(() => {
      expect(screen.getAllByTestId("notification-card")).toHaveLength(3);
    });

    const typeBadges = screen.getAllByTestId("notification-type-badge");
    expect(typeBadges[0]).toHaveTextContent("Memory Sync");
    expect(typeBadges[1]).toHaveTextContent("Neural Map Insight");
    expect(typeBadges[2]).toHaveTextContent("Brain Suggestion");
  });

  it("shows unread badge count in header", async () => {
    setupSupabaseMock();
    await renderNotifications();

    await waitFor(() => {
      expect(screen.getByTestId("header-unread-count")).toBeInTheDocument();
    });

    // 2 unread (notif-1 and notif-3 have read_at === null)
    expect(screen.getByTestId("header-unread-count")).toHaveTextContent(
      "2 unread"
    );
  });

  it("shows unread dot for unread notifications", async () => {
    setupSupabaseMock();
    await renderNotifications();

    await waitFor(() => {
      expect(screen.getAllByTestId("notification-card")).toHaveLength(3);
    });

    // 2 unread notifications should have unread dots
    const unreadDots = screen.getAllByTestId("unread-dot");
    expect(unreadDots).toHaveLength(2);
  });

  it("dismisses a notification", async () => {
    setupSupabaseMock();
    mockSingle.mockResolvedValue({
      data: {
        ...MOCK_NOTIFICATIONS[0],
        dismissed_at: new Date().toISOString(),
      },
      error: null,
    });
    mockEq.mockReturnValue({ select: () => ({ single: mockSingle }) });
    mockUpdate.mockReturnValue({ eq: mockEq });

    const user = userEvent.setup();
    await renderNotifications();

    await waitFor(() => {
      expect(screen.getAllByTestId("dismiss-button")).toHaveLength(3);
    });

    await user.click(screen.getAllByTestId("dismiss-button")[0]);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ dismissed_at: expect.any(String) })
    );
    expect(mockEq).toHaveBeenCalledWith("id", "notif-1");
  });

  it("shows empty state when no notifications", async () => {
    setupSupabaseMock([]);
    await renderNotifications();

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
    expect(screen.getByText("No notifications")).toBeInTheDocument();
  });

  it("does not show unread badge when all are read", async () => {
    const allRead = MOCK_NOTIFICATIONS.map((n) => ({
      ...n,
      read_at: "2026-03-26T12:00:00Z",
    })) as typeof MOCK_NOTIFICATIONS;
    setupSupabaseMock(allRead);
    await renderNotifications();

    await waitFor(() => {
      expect(screen.getAllByTestId("notification-card")).toHaveLength(3);
    });

    expect(screen.queryByTestId("header-unread-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("unread-dot")).not.toBeInTheDocument();
  });

  it("navigates back when back button is clicked", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderNotifications();

    await waitFor(() => {
      expect(screen.getByTestId("back-button")).toBeInTheDocument();
    });

    // Back button should be rendered and clickable (navigates to /chat via useNavigate)
    await user.click(screen.getByTestId("back-button"));
  });

  it("queries only undismissed notifications", async () => {
    setupSupabaseMock();
    await renderNotifications();

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("notifications");
    });

    // Should filter dismissed_at IS NULL
    expect(mockIs).toHaveBeenCalledWith("dismissed_at", null);
  });
});
