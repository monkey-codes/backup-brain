import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before importing components that use it
const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
      signInWithPassword: (creds: unknown) => mockSignInWithPassword(creds),
      signOut: () => mockSignOut(),
    },
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        is: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      insert: vi.fn(),
    }),
    channel: () => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    }),
    removeChannel: vi.fn(),
  },
}));

import { AuthProvider } from "../hooks/use-auth";
import { SessionProvider } from "../hooks/use-sessions";
import { AppRoutes } from "../App";

function setupAuthMock(session: unknown = null) {
  mockGetSession.mockResolvedValue({ data: { session } });
  mockOnAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
}

async function renderApp(initialRoute = "/chat") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SessionProvider>
            <MemoryRouter initialEntries={[initialRoute]}>
              <AppRoutes />
            </MemoryRouter>
          </SessionProvider>
        </AuthProvider>
      </QueryClientProvider>
    );
  });
  return result!;
}

describe("Auth flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to login", async () => {
    setupAuthMock(null);
    await renderApp("/chat");

    await waitFor(() => {
      expect(
        screen.getByText("Secure your digital consciousness.")
      ).toBeInTheDocument();
    });
  });

  it("shows the chat shell when authenticated", async () => {
    setupAuthMock({
      user: { id: "user-1", email: "test@example.com" },
      access_token: "token",
    });

    await renderApp("/chat");

    // The shell renders with top app bar and bottom nav
    await waitFor(() => {
      expect(screen.getByTestId("top-app-bar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
  });

  it("shows login form fields", async () => {
    setupAuthMock(null);
    await renderApp("/login");

    await waitFor(() => {
      expect(screen.getByLabelText("Neural ID")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Access Key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("submits login form and shows error on failure", async () => {
    setupAuthMock(null);
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });

    const user = userEvent.setup();
    await renderApp("/login");

    await waitFor(() => {
      expect(screen.getByLabelText("Neural ID")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Neural ID"), "test@example.com");
    await user.type(screen.getByLabelText("Access Key"), "wrongpassword");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Invalid login credentials"
      );
    });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "wrongpassword",
    });
  });

  it("submits login form successfully and transitions to chat", async () => {
    setupAuthMock(null);

    let authCallback: (event: string, session: unknown) => void;
    mockOnAuthStateChange.mockImplementation((cb: typeof authCallback) => {
      authCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    mockSignInWithPassword.mockImplementation(async () => {
      authCallback("SIGNED_IN", {
        user: { id: "user-1", email: "test@example.com" },
        access_token: "token",
      });
      return { error: null };
    });

    const user = userEvent.setup();
    await renderApp("/login");

    await waitFor(() => {
      expect(screen.getByLabelText("Neural ID")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Neural ID"), "test@example.com");
    await user.type(screen.getByLabelText("Access Key"), "correctpassword");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // After login, should see the app shell with the user's email in drawer
    await waitFor(() => {
      expect(screen.getByTestId("top-app-bar")).toBeInTheDocument();
    });
  });

  it("signs out and returns to login", async () => {
    let authCallback: (event: string, session: unknown) => void;
    mockOnAuthStateChange.mockImplementation((cb: typeof authCallback) => {
      authCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "user-1", email: "test@example.com" },
          access_token: "token",
        },
      },
    });

    mockSignOut.mockImplementation(async () => {
      authCallback("SIGNED_OUT", null);
    });

    const user = userEvent.setup();
    await renderApp("/chat");

    // Open the drawer to access sign out
    await waitFor(() => {
      expect(screen.getByTestId("menu-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("menu-button"));

    await waitFor(() => {
      expect(screen.getByTestId("drawer-sign-out")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("drawer-sign-out"));

    await waitFor(() => {
      expect(
        screen.getByText("Secure your digital consciousness.")
      ).toBeInTheDocument();
    });
  });

  it("shows loading state while checking auth", () => {
    mockGetSession.mockReturnValue(new Promise(() => {}));
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SessionProvider>
            <MemoryRouter initialEntries={["/chat"]}>
              <AppRoutes />
            </MemoryRouter>
          </SessionProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
