import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before importing components
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();

const mockChannelObj = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
  unsubscribe: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
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
      signOut: vi.fn(),
    },
    from: (...args: unknown[]) => mockFrom(...args),
    channel: () => mockChannelObj,
    removeChannel: vi.fn(),
  },
}));

import { ChatShell } from "../views/chat-shell";
import { AuthProvider } from "../hooks/use-auth";
import { SessionProvider } from "../hooks/use-sessions";

const MOCK_SESSIONS = [
  {
    id: "session-1",
    user_id: "user-1",
    title: "First conversation",
    created_at: "2026-03-26T10:00:00Z",
    updated_at: "2026-03-26T10:00:00Z",
  },
  {
    id: "session-2",
    user_id: "user-1",
    title: "Second conversation",
    created_at: "2026-03-26T11:00:00Z",
    updated_at: "2026-03-26T11:00:00Z",
  },
  {
    id: "session-3",
    user_id: "user-1",
    title: null,
    created_at: "2026-03-26T12:00:00Z",
    updated_at: "2026-03-26T12:00:00Z",
  },
];

function setupSupabaseMock(sessions = MOCK_SESSIONS) {
  mockOrder.mockResolvedValue({ data: sessions, error: null });
  mockSelect.mockReturnValue({ order: mockOrder });

  const mockMsgOrder = vi.fn().mockResolvedValue({ data: [], error: null });
  const mockMsgEq = vi.fn().mockReturnValue({ order: mockMsgOrder });
  const mockMsgSelect = vi.fn().mockReturnValue({ eq: mockMsgEq });

  // Notifications mock
  const mockNotifOrder = vi.fn().mockResolvedValue({ data: [], error: null });
  const mockNotifIs = vi.fn().mockReturnValue({ order: mockNotifOrder });
  const mockNotifSelect = vi
    .fn()
    .mockReturnValue({ is: mockNotifIs, order: mockNotifOrder });

  mockFrom.mockImplementation((table: string) => {
    if (table === "chat_sessions") {
      return { select: mockSelect, insert: mockInsert };
    }
    if (table === "chat_messages") {
      return { select: mockMsgSelect, insert: vi.fn() };
    }
    if (table === "notifications") {
      return { select: mockNotifSelect, update: vi.fn() };
    }
    return { select: vi.fn(), insert: vi.fn() };
  });
}

async function renderChatShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SessionProvider>
            <MemoryRouter>
              <ChatShell />
            </MemoryRouter>
          </SessionProvider>
        </AuthProvider>
      </QueryClientProvider>
    );
  });
  return result!;
}

describe("Chat sessions — drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens drawer when menu button is clicked", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    const drawer = screen.getByTestId("session-drawer");
    expect(drawer).toHaveAttribute("data-open", "false");

    await user.click(screen.getByTestId("menu-button"));

    expect(drawer).toHaveAttribute("data-open", "true");
  });

  it("lists sessions in the drawer", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    // Open drawer
    await user.click(screen.getByTestId("menu-button"));

    await waitFor(() => {
      expect(screen.getByText("First conversation")).toBeInTheDocument();
    });
    expect(screen.getByText("Second conversation")).toBeInTheDocument();
  });

  it("shows 'New chat' as title for sessions without a title", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    await user.click(screen.getByTestId("menu-button"));

    await waitFor(() => {
      const sessions = screen.getAllByTestId("drawer-session");
      const untitledSession = sessions.find(
        (s) => s.textContent === "New chat"
      );
      expect(untitledSession).toBeInTheDocument();
    });
  });

  it("creates a new session when clicking new chat button", async () => {
    setupSupabaseMock();
    const newSession = {
      id: "session-new",
      user_id: "user-1",
      title: null,
      created_at: "2026-03-26T13:00:00Z",
      updated_at: "2026-03-26T13:00:00Z",
    };
    mockSingle.mockResolvedValue({ data: newSession, error: null });
    mockInsert.mockReturnValue({
      select: () => ({ single: mockSingle }),
    });

    const user = userEvent.setup();
    await renderChatShell();

    // Open drawer first
    await user.click(screen.getByTestId("menu-button"));

    await waitFor(() => {
      expect(screen.getByText("First conversation")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("new-chat-button"));

    expect(mockInsert).toHaveBeenCalledWith({
      user_id: "user-1",
    });
  });

  it("switches to a session when clicking on it and closes drawer", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    // Open drawer
    await user.click(screen.getByTestId("menu-button"));

    await waitFor(() => {
      expect(screen.getByText("First conversation")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Second conversation"));

    // Drawer should close after selecting
    const drawer = screen.getByTestId("session-drawer");
    expect(drawer).toHaveAttribute("data-open", "false");

    // Session title should update in top bar
    expect(screen.getByTestId("session-title")).toHaveTextContent(
      "Second conversation"
    );
  });

  it("closes drawer when backdrop is tapped", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    await user.click(screen.getByTestId("menu-button"));

    const drawer = screen.getByTestId("session-drawer");
    expect(drawer).toHaveAttribute("data-open", "true");

    await user.click(screen.getByTestId("drawer-backdrop"));

    expect(drawer).toHaveAttribute("data-open", "false");
  });

  it("shows user email in drawer", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    await user.click(screen.getByTestId("menu-button"));

    await waitFor(() => {
      expect(screen.getByTestId("drawer-email")).toHaveTextContent(
        "test@example.com"
      );
    });
  });

  it("highlights active session with blue left border", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    await user.click(screen.getByTestId("menu-button"));

    await waitFor(() => {
      expect(screen.getByText("First conversation")).toBeInTheDocument();
    });

    // Select a session
    await user.click(screen.getByText("First conversation"));

    // Reopen drawer to check active state
    await user.click(screen.getByTestId("menu-button"));

    const sessions = screen.getAllByTestId("drawer-session");
    const activeSession = sessions.find(
      (s) => s.getAttribute("data-active") === "true"
    );
    expect(activeSession).toHaveTextContent("First conversation");
  });
});

describe("Top app bar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders glassmorphic top app bar with hamburger, title, and bell", async () => {
    setupSupabaseMock();
    await renderChatShell();

    expect(screen.getByTestId("top-app-bar")).toBeInTheDocument();
    expect(screen.getByTestId("menu-button")).toBeInTheDocument();
    expect(screen.getByTestId("session-title")).toBeInTheDocument();
    expect(screen.getByTestId("bell-button")).toBeInTheDocument();
  });

  it("shows session title in top bar", async () => {
    setupSupabaseMock();
    await renderChatShell();

    expect(screen.getByTestId("session-title")).toHaveTextContent(
      "Backup Brain"
    );
  });
});

describe("Bell icon + notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tapping bell icon shows notifications view", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    await user.click(screen.getByTestId("bell-button"));

    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
    });
  });

  it("tapping bell again returns to chat", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    await user.click(screen.getByTestId("bell-button"));
    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("bell-button"));
    // Should no longer show notifications header
    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
  });

  it("hides unread badge when count is zero", async () => {
    setupSupabaseMock();
    await renderChatShell();

    // With no notifications, badge should not show
    expect(screen.queryByTestId("unread-badge")).not.toBeInTheDocument();
  });
});

describe("Bottom nav bar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders bottom nav with Chat and Review tabs", async () => {
    setupSupabaseMock();
    await renderChatShell();

    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
    expect(screen.getByTestId("nav-chat")).toBeInTheDocument();
    expect(screen.getByTestId("nav-review")).toBeInTheDocument();
  });

  it("Chat tab is active by default", async () => {
    setupSupabaseMock();
    await renderChatShell();

    const chatTab = screen.getByTestId("nav-chat");
    expect(chatTab.className).toContain("text-primary");
  });

  it("tapping Review tab shows decision review view", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    await user.click(screen.getByTestId("nav-review"));

    await waitFor(() => {
      expect(screen.getByTestId("filter-needs-review")).toBeInTheDocument();
    });

    // Review tab should now be active
    const reviewTab = screen.getByTestId("nav-review");
    expect(reviewTab.className).toContain("text-primary");
  });

  it("tapping Chat tab returns to chat view", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    // Switch to review
    await user.click(screen.getByTestId("nav-review"));
    await waitFor(() => {
      expect(screen.getByTestId("filter-needs-review")).toBeInTheDocument();
    });

    // Switch back to chat
    await user.click(screen.getByTestId("nav-chat"));

    // Chat tab should be active again
    const chatTab = screen.getByTestId("nav-chat");
    expect(chatTab.className).toContain("text-primary");
  });
});

describe("Nav integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tapping bell while on review switches to notifications", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    // Go to review
    await user.click(screen.getByTestId("nav-review"));
    await waitFor(() => {
      expect(screen.getByTestId("filter-needs-review")).toBeInTheDocument();
    });

    // Tap bell
    await user.click(screen.getByTestId("bell-button"));
    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
    });
  });

  it("tapping a bottom tab while on notifications switches back", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    await renderChatShell();

    // Go to notifications
    await user.click(screen.getByTestId("bell-button"));
    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
    });

    // Tap chat tab
    await user.click(screen.getByTestId("nav-chat"));

    // Notifications view should be gone
    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
  });

  it("main content area is a flex column container for proper scroll layout", async () => {
    setupSupabaseMock();
    await renderChatShell();

    // The <main> element must be flex flex-col so child views can use flex-1
    // to fill available height and enable scrolling within bounded containers
    const topBar = screen.getByTestId("top-app-bar");
    const main = topBar.parentElement!.querySelector("main");
    expect(main).toBeTruthy();
    expect(main!.className).toContain("flex");
    expect(main!.className).toContain("flex-col");
    expect(main!.className).toContain("overflow-hidden");
  });

  it("no desktop sidebar exists", async () => {
    setupSupabaseMock();
    await renderChatShell();

    expect(screen.queryByTestId("session-sidebar")).not.toBeInTheDocument();
  });
});
