import { format, parseISO } from "date-fns";
import type { Reminder } from "./use-reminders";

interface DayDetailProps {
  date: string; // "YYYY-MM-DD"
  reminders: Reminder[];
  onBack: () => void;
}

function formatTimeUTC(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function reviewStatusBadge(status: string) {
  const color =
    status === "accepted"
      ? "bg-green-900/40 text-green-400"
      : status === "corrected"
        ? "bg-primary/15 text-primary"
        : "bg-surface-container-highest text-on-surface-variant";
  return (
    <span
      data-testid="review-status-badge"
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${color}`}
    >
      {status}
    </span>
  );
}

export function DayDetail({ date, reminders, onBack }: DayDetailProps) {
  const formattedDate = format(parseISO(date), "EEEE, MMMM d, yyyy");

  const sorted = [...reminders].sort(
    (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
  );

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="day-detail-header"
        className="flex items-center gap-3 px-4 py-3"
      >
        <button
          data-testid="day-detail-back"
          onClick={onBack}
          className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container"
        >
          ←
        </button>
        <h3 className="text-lg font-semibold text-on-surface">
          {formattedDate}
        </h3>
      </div>

      {sorted.length === 0 ? (
        <div
          data-testid="day-detail-empty"
          className="px-4 py-8 text-center text-on-surface-variant"
        >
          No reminders for this day
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4">
          {sorted.map((reminder) => (
            <div
              key={reminder.id}
              data-testid="reminder-card"
              className="flex items-start justify-between rounded-lg bg-surface-container p-3"
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-on-surface">
                  {reminder.description}
                </span>
                <span className="text-xs text-on-surface-variant">
                  {formatTimeUTC(reminder.due_at)}
                </span>
              </div>
              {reviewStatusBadge(reminder.review_status)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
