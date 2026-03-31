import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before importing components
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockChannel = vi.fn();
const mockOn = vi.fn();
const mockSubscribe = vi.fn();
const mockRemoveChannel = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

import { ChatView } from "../components/chat-view";

const MOCK_MESSAGES = [
  {
    id: "msg-1",
    session_id: "session-1",
    role: "user",
    content: "Hello, remember my dentist appointment on Friday",
    created_at: "2026-03-26T10:00:00Z",
  },
  {
    id: "msg-2",
    session_id: "session-1",
    role: "assistant",
    content: "Got it! I've noted your dentist appointment for Friday.",
    created_at: "2026-03-26T10:00:01Z",
  },
];

function setupSupabaseMock(messages = MOCK_MESSAGES) {
  mockOrder.mockResolvedValue({ data: messages, error: null });
  mockEq.mockReturnValue({ order: mockOrder });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockFrom.mockImplementation((table: string) => {
    if (table === "chat_messages") {
      return { select: mockSelect, insert: mockInsert };
    }
    return { select: vi.fn(), insert: vi.fn() };
  });

  // Mock Realtime channel
  mockSubscribe.mockReturnValue({ unsubscribe: vi.fn() });
  mockOn.mockReturnValue({ subscribe: mockSubscribe });
  mockChannel.mockReturnValue({ on: mockOn });
}

function renderChatView(sessionId = "session-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatView sessionId={sessionId} />
    </QueryClientProvider>
  );
}

describe("ChatView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders messages for the current session", async () => {
    setupSupabaseMock();
    renderChatView();

    await waitFor(() => {
      expect(
        screen.getByText("Hello, remember my dentist appointment on Friday")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "Got it! I've noted your dentist appointment for Friday."
      )
    ).toBeInTheDocument();

    expect(mockFrom).toHaveBeenCalledWith("chat_messages");
  });

  it("shows user messages aligned right and assistant messages aligned left", async () => {
    setupSupabaseMock();
    renderChatView();

    await waitFor(() => {
      expect(screen.getAllByTestId("chat-message")).toHaveLength(2);
    });

    const messages = screen.getAllByTestId("chat-message");
    expect(messages[0]).toHaveAttribute("data-role", "user");
    expect(messages[1]).toHaveAttribute("data-role", "assistant");
  });

  it("sends a message optimistically on submit", async () => {
    setupSupabaseMock();
    const newMsg = {
      id: "msg-3",
      session_id: "session-1",
      role: "user",
      content: "New thought",
      created_at: "2026-03-26T10:01:00Z",
    };
    mockSingle.mockResolvedValue({ data: newMsg, error: null });
    mockInsert.mockReturnValue({
      select: () => ({ single: mockSingle }),
    });

    const user = userEvent.setup();
    renderChatView();

    // Wait for initial messages to load
    await waitFor(() => {
      expect(
        screen.getByText("Hello, remember my dentist appointment on Friday")
      ).toBeInTheDocument();
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "New thought");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    // Verify the insert was called with correct data
    expect(mockInsert).toHaveBeenCalledWith({
      session_id: "session-1",
      role: "user",
      content: "New thought",
    });
  });

  it("clears input after sending", async () => {
    setupSupabaseMock();
    mockSingle.mockResolvedValue({
      data: {
        id: "msg-x",
        session_id: "session-1",
        role: "user",
        content: "test",
        created_at: new Date().toISOString(),
      },
      error: null,
    });
    mockInsert.mockReturnValue({
      select: () => ({ single: mockSingle }),
    });

    const user = userEvent.setup();
    renderChatView();

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "test");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(input).toHaveValue("");
  });

  it("does not send empty messages", async () => {
    setupSupabaseMock();
    renderChatView();

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    const sendButton = screen.getByRole("button", { name: "Send message" });
    expect(sendButton).toBeDisabled();
  });

  it("shows thinking indicator when last message is from user", async () => {
    const messagesWithPendingReply = [MOCK_MESSAGES[0]]; // Only user message
    setupSupabaseMock(messagesWithPendingReply);
    renderChatView();

    await waitFor(() => {
      expect(screen.getByTestId("thinking-indicator")).toBeInTheDocument();
    });
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("does not show thinking indicator when last message is from assistant", async () => {
    setupSupabaseMock(); // Both user and assistant messages
    renderChatView();

    await waitFor(() => {
      expect(screen.getAllByTestId("chat-message")).toHaveLength(2);
    });

    expect(screen.queryByTestId("thinking-indicator")).not.toBeInTheDocument();
  });

  it("subscribes to Realtime for the session", async () => {
    setupSupabaseMock();
    renderChatView();

    await waitFor(() => {
      expect(mockChannel).toHaveBeenCalledWith("messages:session-1");
    });
    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: "session_id=eq.session-1",
      }),
      expect.any(Function)
    );
  });

  it("sends message on Enter key", async () => {
    setupSupabaseMock();
    mockSingle.mockResolvedValue({
      data: {
        id: "msg-y",
        session_id: "session-1",
        role: "user",
        content: "enter test",
        created_at: new Date().toISOString(),
      },
      error: null,
    });
    mockInsert.mockReturnValue({
      select: () => ({ single: mockSingle }),
    });

    const user = userEvent.setup();
    renderChatView();

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "enter test{Enter}");

    expect(mockInsert).toHaveBeenCalledWith({
      session_id: "session-1",
      role: "user",
      content: "enter test",
    });
  });
});
