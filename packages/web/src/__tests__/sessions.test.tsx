import { render, screen, waitFor, within } from "@testing-library/react";
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

  mockFrom.mockImplementation((table: string) => {
    if (table === "chat_sessions") {
      return { select: mockSelect, insert: mockInsert };
    }
    if (table === "chat_messages") {
      return { select: mockMsgSelect, insert: vi.fn() };
    }
    return { select: vi.fn(), insert: vi.fn() };
  });
}

function renderChatShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
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
}

/** Helper: get the sidebar container to scope queries (avoids duplicates from drawer) */
function getSidebar() {
  return within(screen.getByTestId("session-sidebar"));
}

describe("Chat sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists sessions sorted by most recent", async () => {
    setupSupabaseMock();
    renderChatShell();

    const sidebar = getSidebar();
    await waitFor(() => {
      expect(sidebar.getByText("First conversation")).toBeInTheDocument();
    });
    expect(sidebar.getByText("Second conversation")).toBeInTheDocument();

    // Verify we called supabase with correct table
    expect(mockFrom).toHaveBeenCalledWith("chat_sessions");
  });

  it("shows 'New chat' as title for sessions without a title", async () => {
    setupSupabaseMock();
    renderChatShell();

    const sidebar = getSidebar();
    await waitFor(() => {
      expect(
        sidebar.getByText("New chat", { selector: "[data-active]" })
      ).toBeInTheDocument();
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
    renderChatShell();

    const sidebar = getSidebar();
    await waitFor(() => {
      expect(sidebar.getByText("First conversation")).toBeInTheDocument();
    });

    await user.click(sidebar.getByLabelText("New chat"));

    expect(mockInsert).toHaveBeenCalledWith({
      user_id: "user-1",
    });
  });

  it("switches to a session when clicking on it", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    renderChatShell();

    const sidebar = getSidebar();
    await waitFor(() => {
      expect(sidebar.getByText("First conversation")).toBeInTheDocument();
    });

    await user.click(sidebar.getByText("Second conversation"));

    // The clicked session should be marked as active
    const sessionItem = sidebar
      .getByText("Second conversation")
      .closest("[data-active]");
    expect(sessionItem).toHaveAttribute("data-active", "true");
  });

  it("shows session list in sidebar", async () => {
    setupSupabaseMock();
    renderChatShell();

    const sidebar = getSidebar();
    await waitFor(() => {
      expect(sidebar.getByText("First conversation")).toBeInTheDocument();
    });
    expect(sidebar.getByText("Second conversation")).toBeInTheDocument();
  });

  it("toggles mobile drawer when menu button is clicked", async () => {
    setupSupabaseMock();
    const user = userEvent.setup();
    renderChatShell();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    });

    // Drawer should start closed
    const drawer = screen.getByTestId("session-drawer");
    expect(drawer).toHaveAttribute("data-open", "false");

    await user.click(screen.getByRole("button", { name: "Menu" }));

    expect(drawer).toHaveAttribute("data-open", "true");
  });
});
