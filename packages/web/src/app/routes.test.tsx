import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock("@/shared/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        is: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
        or: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      insert: vi.fn(),
      update: vi.fn(),
    }),
    channel: () => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    }),
    removeChannel: vi.fn(),
  },
}));

import { AuthProvider } from "../features/auth/use-auth";

import { AppRoutes } from "../App";

function setupAuthMock(session: unknown = null) {
  mockGetSession.mockResolvedValue({ data: { session } });
  mockOnAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
}

const AUTHED_SESSION = {
  user: { id: "user-1", email: "test@example.com" },
  access_token: "token",
};

async function renderApp(initialRoute = "/chat") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={[initialRoute]}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
  });
  return result!;
}

describe("Route configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("/ redirects to /chat", async () => {
    setupAuthMock(AUTHED_SESSION);
    await renderApp("/");

    await waitFor(() => {
      expect(screen.getByTestId("top-app-bar")).toBeInTheDocument();
    });
    // Chat tab should be active
    expect(screen.getByTestId("nav-chat").className).toContain("text-primary");
  });

  it("unknown paths redirect to /chat", async () => {
    setupAuthMock(AUTHED_SESSION);
    await renderApp("/unknown-path");

    await waitFor(() => {
      expect(screen.getByTestId("top-app-bar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("nav-chat").className).toContain("text-primary");
  });

  it("unauthenticated users are redirected to /login", async () => {
    setupAuthMock(null);
    await renderApp("/chat");

    await waitFor(() => {
      expect(
        screen.getByText("Secure your digital consciousness.")
      ).toBeInTheDocument();
    });
  });

  it("unauthenticated access to /review redirects to /login", async () => {
    setupAuthMock(null);
    await renderApp("/review");

    await waitFor(() => {
      expect(
        screen.getByText("Secure your digital consciousness.")
      ).toBeInTheDocument();
    });
  });

  it("unauthenticated access to /notifications redirects to /login", async () => {
    setupAuthMock(null);
    await renderApp("/notifications");

    await waitFor(() => {
      expect(
        screen.getByText("Secure your digital consciousness.")
      ).toBeInTheDocument();
    });
  });

  it("unauthenticated access to /reminders redirects to /login", async () => {
    setupAuthMock(null);
    await renderApp("/reminders");

    await waitFor(() => {
      expect(
        screen.getByText("Secure your digital consciousness.")
      ).toBeInTheDocument();
    });
  });

  it("/login renders minimal layout without app shell", async () => {
    setupAuthMock(null);
    await renderApp("/login");

    await waitFor(() => {
      expect(screen.getByLabelText("Neural ID")).toBeInTheDocument();
    });
    // No app shell elements
    expect(screen.queryByTestId("top-app-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bottom-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-drawer")).not.toBeInTheDocument();
  });
});

describe("Route navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clicking Chat bottom nav tab navigates to /chat", async () => {
    setupAuthMock(AUTHED_SESSION);
    const user = userEvent.setup();
    await renderApp("/review");

    await waitFor(() => {
      expect(screen.getByTestId("nav-chat")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("nav-chat"));

    await waitFor(() => {
      expect(screen.getByTestId("nav-chat").className).toContain(
        "text-primary"
      );
    });
  });

  it("clicking Review bottom nav tab navigates to /review", async () => {
    setupAuthMock(AUTHED_SESSION);
    const user = userEvent.setup();
    await renderApp("/chat");

    await waitFor(() => {
      expect(screen.getByTestId("nav-review")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("nav-review"));

    await waitFor(() => {
      expect(screen.getByTestId("nav-review").className).toContain(
        "text-primary"
      );
    });
  });

  it("clicking notification bell navigates to /notifications", async () => {
    setupAuthMock(AUTHED_SESSION);
    const user = userEvent.setup();
    await renderApp("/chat");

    await waitFor(() => {
      expect(screen.getByTestId("bell-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("bell-button"));

    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
    });
  });

  it("clicking Calendar bottom nav tab navigates to /reminders", async () => {
    setupAuthMock(AUTHED_SESSION);
    const user = userEvent.setup();
    await renderApp("/chat");

    await waitFor(() => {
      expect(screen.getByTestId("nav-reminders")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("nav-reminders"));

    await waitFor(() => {
      expect(screen.getByTestId("nav-reminders").className).toContain(
        "text-primary"
      );
    });
  });

  it("bottom nav highlights correct tab based on URL", async () => {
    setupAuthMock(AUTHED_SESSION);
    await renderApp("/review");

    await waitFor(() => {
      expect(screen.getByTestId("nav-review")).toBeInTheDocument();
    });

    expect(screen.getByTestId("nav-review").className).toContain(
      "text-primary"
    );
    expect(screen.getByTestId("nav-chat").className).not.toContain(
      "text-primary"
    );
  });

  it("Calendar tab shows active styling on /reminders", async () => {
    setupAuthMock(AUTHED_SESSION);
    await renderApp("/reminders");

    await waitFor(() => {
      expect(screen.getByTestId("nav-reminders")).toBeInTheDocument();
    });

    expect(screen.getByTestId("nav-reminders").className).toContain(
      "text-primary"
    );
    expect(screen.getByTestId("nav-chat").className).not.toContain(
      "text-primary"
    );
    expect(screen.getByTestId("nav-review").className).not.toContain(
      "text-primary"
    );
  });

  it("app shell persists across authenticated views", async () => {
    setupAuthMock(AUTHED_SESSION);
    const user = userEvent.setup();
    await renderApp("/chat");

    await waitFor(() => {
      expect(screen.getByTestId("top-app-bar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
    expect(screen.getByTestId("session-drawer")).toBeInTheDocument();

    // Navigate to review
    await user.click(screen.getByTestId("nav-review"));
    await waitFor(() => {
      expect(screen.getByTestId("nav-review").className).toContain(
        "text-primary"
      );
    });

    // Shell still present
    expect(screen.getByTestId("top-app-bar")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
    expect(screen.getByTestId("session-drawer")).toBeInTheDocument();

    // Navigate to notifications
    await user.click(screen.getByTestId("bell-button"));
    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
    });

    // Shell still present
    expect(screen.getByTestId("top-app-bar")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
  });

  it("drawer is accessible on all authenticated pages", async () => {
    setupAuthMock(AUTHED_SESSION);
    const user = userEvent.setup();

    // Test on /review
    await renderApp("/review");

    await waitFor(() => {
      expect(screen.getByTestId("menu-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("menu-button"));
    expect(screen.getByTestId("session-drawer")).toHaveAttribute(
      "data-open",
      "true"
    );
  });
});
