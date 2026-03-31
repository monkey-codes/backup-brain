import { useState } from "react";
import {
  Menu,
  X,
  Bell,
  MessageCircle,
  ClipboardCheck,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  useSessions,
  useCreateSession,
  useCurrentSession,
} from "@/hooks/use-sessions";
import { useNotifications, useUnreadCount } from "@/hooks/use-notifications";
import { Button } from "@/components/ui/button";
import { ChatView } from "@/components/chat-view";
import { DecisionReviewView } from "@/views/decision-review";
import { NotificationsView } from "@/views/notifications";
import type { ChatSession } from "@backup-brain/shared";

export function ChatShell() {
  const { user, signOut } = useAuth();
  const { currentSession, setCurrentSession } = useCurrentSession();
  const { data: sessions, isLoading: sessionsLoading } = useSessions();
  const createSession = useCreateSession();
  const { data: notifications } = useNotifications();
  const unreadCount = useUnreadCount(notifications);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState<"chat" | "review" | "notifications">("chat");

  const handleNewChat = async () => {
    const newSession = await createSession.mutateAsync();
    setCurrentSession(newSession);
    setDrawerOpen(false);
    setView("chat");
  };

  const handleSelectSession = (session: ChatSession) => {
    setCurrentSession(session);
    setDrawerOpen(false);
    setView("chat");
  };

  const handleBellClick = () => {
    setView(view === "notifications" ? "chat" : "notifications");
  };

  return (
    <div className="flex h-screen flex-col bg-surface">
      {/* ── Top App Bar (glassmorphic) ── */}
      <header
        data-testid="top-app-bar"
        className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between px-4 backdrop-blur-xl"
        style={{ backgroundColor: "rgba(17, 19, 25, 0.6)" }}
      >
        {/* Left: hamburger */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDrawerOpen(true)}
          aria-label="Menu"
          data-testid="menu-button"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Center: session title */}
        <h1
          data-testid="session-title"
          className="max-w-[60%] truncate font-headline text-sm font-medium text-on-surface"
        >
          {currentSession?.title ?? "Backup Brain"}
        </h1>

        {/* Right: bell icon */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBellClick}
          aria-label="Notifications"
          data-testid="bell-button"
          className="relative"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span
              data-testid="unread-badge"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error"
            >
              {unreadCount}
            </span>
          )}
        </Button>
      </header>

      {/* ── Drawer (all screen sizes) ── */}
      <div
        data-testid="session-drawer"
        data-open={drawerOpen}
        className={`fixed inset-0 z-40 ${drawerOpen ? "" : "pointer-events-none"}`}
      >
        {/* Backdrop */}
        <div
          data-testid="drawer-backdrop"
          className={`absolute inset-0 bg-black/50 transition-opacity ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setDrawerOpen(false)}
        />
        {/* Drawer panel */}
        <div
          className={`absolute inset-y-0 left-0 flex w-72 flex-col bg-surface-container-low transition-transform ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* User info + close */}
          <div className="flex items-center justify-between px-4 py-4">
            <div className="min-w-0">
              <p
                data-testid="drawer-email"
                className="truncate text-sm text-on-surface"
              >
                {user?.email}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={signOut}
                aria-label="Sign out"
                data-testid="drawer-sign-out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* New Chat button (gradient) */}
          <div className="px-4 pb-3">
            <Button
              className="w-full"
              onClick={handleNewChat}
              disabled={createSession.isPending}
              aria-label="New chat"
              data-testid="new-chat-button"
            >
              + New Chat
            </Button>
          </div>

          {/* Recent Sessions */}
          <div className="px-4 pb-2">
            <p className="font-label text-xs uppercase tracking-widest text-on-surface-variant">
              Recent Sessions
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {sessionsLoading && (
              <p className="px-3 py-2 text-sm text-on-surface-variant">
                Loading...
              </p>
            )}
            {sessions?.map((session) => {
              const isActive = currentSession?.id === session.id;
              return (
                <button
                  key={session.id}
                  data-testid="drawer-session"
                  data-active={isActive}
                  onClick={() => handleSelectSession(session)}
                  className={`mb-1 w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? "border-l-4 border-l-primary bg-primary/10 text-on-surface"
                      : "text-on-surface-variant hover:bg-surface-container-high"
                  }`}
                >
                  {session.title ?? "New chat"}
                </button>
              );
            })}
            {!sessionsLoading && sessions?.length === 0 && (
              <p className="px-3 py-2 text-sm text-on-surface-variant">
                No conversations yet
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3">
            <p className="text-xs text-on-surface-variant">Synapse Synced</p>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="flex flex-1 flex-col overflow-hidden pt-14 pb-14">
        {view === "notifications" ? (
          <NotificationsView onBack={() => setView("chat")} />
        ) : view === "review" ? (
          <DecisionReviewView onBack={() => setView("chat")} />
        ) : currentSession ? (
          <ChatView sessionId={currentSession.id} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-on-surface-variant">
              Select a conversation or start a new one
            </p>
          </div>
        )}
      </main>

      {/* ── Bottom Nav Bar (glassmorphic) ── */}
      <nav
        data-testid="bottom-nav"
        className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around backdrop-blur-xl"
        style={{ backgroundColor: "rgba(17, 19, 25, 0.6)" }}
      >
        <button
          data-testid="nav-chat"
          onClick={() => setView("chat")}
          className={`flex flex-col items-center gap-0.5 px-6 py-1 rounded-lg transition-colors ${
            view === "chat"
              ? "bg-primary/15 text-primary"
              : "text-on-surface-variant"
          }`}
        >
          <MessageCircle className="h-5 w-5" />
          <span className="text-xs font-medium">Chat</span>
        </button>
        <button
          data-testid="nav-review"
          onClick={() => setView("review")}
          className={`flex flex-col items-center gap-0.5 px-6 py-1 rounded-lg transition-colors ${
            view === "review"
              ? "bg-primary/15 text-primary"
              : "text-on-surface-variant"
          }`}
        >
          <ClipboardCheck className="h-5 w-5" />
          <span className="text-xs font-medium">Review</span>
        </button>
      </nav>
    </div>
  );
}
