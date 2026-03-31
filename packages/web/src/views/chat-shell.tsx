import { useState } from "react";
import { Menu, X, ClipboardCheck, Bell } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentSession } from "@/hooks/use-sessions";
import { useNotifications, useUnreadCount } from "@/hooks/use-notifications";
import { Button } from "@/components/ui/button";
import { SessionList } from "@/components/session-list";
import { ChatView } from "@/components/chat-view";
import { DecisionReviewView } from "@/views/decision-review";
import { NotificationsView } from "@/views/notifications";

export function ChatShell() {
  const { user, signOut } = useAuth();
  const { currentSession } = useCurrentSession();
  const { data: notifications } = useNotifications();
  const unreadCount = useUnreadCount(notifications);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState<"chat" | "review" | "notifications">("chat");

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        data-testid="session-sidebar"
        className="hidden w-64 flex-shrink-0 border-r md:flex md:flex-col"
      >
        <SessionList />
      </aside>

      {/* Mobile drawer */}
      <div
        data-testid="session-drawer"
        data-open={drawerOpen}
        className={`fixed inset-0 z-40 md:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
      >
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setDrawerOpen(false)}
        />
        {/* Drawer panel */}
        <div
          className={`absolute inset-y-0 left-0 w-64 bg-background shadow-lg transition-transform ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-end border-b p-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <SessionList onSessionSelect={() => setDrawerOpen(false)} />
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold">
              {currentSession?.title ?? "Backup Brain"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant={view === "notifications" ? "default" : "outline"}
              size="sm"
              onClick={() =>
                setView(view === "notifications" ? "chat" : "notifications")
              }
              data-testid="notifications-nav-button"
              className="relative"
            >
              <Bell className="mr-1 h-4 w-4" />
              Notifications
              {unreadCount > 0 && (
                <span
                  data-testid="unread-badge"
                  className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                >
                  {unreadCount}
                </span>
              )}
            </Button>
            <Button
              variant={view === "review" ? "default" : "outline"}
              size="sm"
              onClick={() => setView(view === "review" ? "chat" : "review")}
              data-testid="review-nav-button"
            >
              <ClipboardCheck className="mr-1 h-4 w-4" />
              Review
            </Button>
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </header>
        {view === "notifications" ? (
          <NotificationsView onBack={() => setView("chat")} />
        ) : view === "review" ? (
          <DecisionReviewView onBack={() => setView("chat")} />
        ) : currentSession ? (
          <ChatView sessionId={currentSession.id} />
        ) : (
          <main className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground">
              Select a conversation or start a new one
            </p>
          </main>
        )}
      </div>
    </div>
  );
}
