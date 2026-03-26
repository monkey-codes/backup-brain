import { ArrowLeft, Bell, X, Loader2 } from "lucide-react";
import type { Notification, NotificationType } from "@backup-brain/shared";
import { Button } from "@/components/ui/button";
import {
  useNotifications,
  useUnreadCount,
  useDismissNotification,
  useMarkNotificationRead,
} from "@/hooks/use-notifications";

function typeBadge(type: NotificationType) {
  const colors: Record<NotificationType, string> = {
    reminder: "bg-amber-100 text-amber-800",
    suggestion: "bg-blue-100 text-blue-800",
    insight: "bg-purple-100 text-purple-800",
  };
  return (
    <span
      data-testid="notification-type-badge"
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${colors[type]}`}
    >
      {type}
    </span>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function NotificationCard({
  notification,
  onDismiss,
  onMarkRead,
  isDismissing,
}: {
  notification: Notification;
  onDismiss: () => void;
  onMarkRead: () => void;
  isDismissing: boolean;
}) {
  const isUnread = notification.read_at === null;

  return (
    <div
      data-testid="notification-card"
      className={`relative rounded-lg border bg-card p-4 shadow-sm ${
        isUnread ? "border-l-4 border-l-blue-500" : ""
      }`}
      onClick={() => {
        if (isUnread) onMarkRead();
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {typeBadge(notification.type)}
          {isUnread && (
            <span
              data-testid="unread-dot"
              className="h-2 w-2 rounded-full bg-blue-500"
            />
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          disabled={isDismissing}
          aria-label="Dismiss notification"
          data-testid="dismiss-button"
        >
          {isDismissing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
        </Button>
      </div>

      {/* Content */}
      <h3 className="mt-1 text-sm font-semibold">{notification.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>

      {/* Timestamp */}
      <p className="mt-2 text-xs text-muted-foreground">
        {formatDate(notification.created_at)}
      </p>
    </div>
  );
}

export function NotificationsView({ onBack }: { onBack: () => void }) {
  const { data: notifications, isLoading } = useNotifications();
  const unreadCount = useUnreadCount(notifications);
  const dismissMutation = useDismissNotification();
  const markReadMutation = useMarkNotificationRead();

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Back to chat"
            data-testid="back-button"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-lg font-semibold">Notifications</h2>
          {unreadCount > 0 && (
            <span
              data-testid="header-unread-count"
              className="rounded-full bg-blue-500 px-2 py-0.5 text-xs font-medium text-white"
            >
              {unreadCount} unread
            </span>
          )}
        </div>
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && (!notifications || notifications.length === 0) && (
            <div data-testid="empty-state" className="flex flex-col items-center py-12 text-center">
              <Bell className="mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">No notifications</p>
              <p className="mt-1 text-sm text-muted-foreground/70">
                Reminders and insights will appear here
              </p>
            </div>
          )}
          {notifications?.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              isDismissing={
                dismissMutation.isPending &&
                dismissMutation.variables === notification.id
              }
              onDismiss={() => dismissMutation.mutate(notification.id)}
              onMarkRead={() => markReadMutation.mutate(notification.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
