import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  format,
  isSameDay,
} from "date-fns";
import { cn } from "@/shared/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface MonthGridProps {
  year: number;
  month: number; // 1-indexed
  today: Date;
  reminderCounts: Record<string, number>;
  selectedDay: string | null;
  onDayClick: (dateKey: string) => void;
}

export function MonthGrid({
  year,
  month,
  today,
  reminderCounts,
  selectedDay,
  onDayClick,
}: MonthGridProps) {
  const monthStart = startOfMonth(new Date(year, month - 1));
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // getDay returns 0=Sun, 1=Mon, ..., 6=Sat
  // For Mon-start: Mon=0, Tue=1, ..., Sun=6
  const startDayOfWeek = getDay(monthStart);
  const leadingEmpty = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAYS.map((day) => (
        <div
          key={day}
          data-testid="weekday-header"
          className="py-2 text-center text-xs font-medium uppercase tracking-widest text-on-surface-variant"
        >
          {day}
        </div>
      ))}

      {Array.from({ length: leadingEmpty }).map((_, i) => (
        <div key={`empty-${i}`} data-testid="empty-cell" />
      ))}

      {days.map((day) => {
        const dateKey = format(day, "yyyy-MM-dd");
        const count = reminderCounts[dateKey] ?? 0;
        const isToday = isSameDay(day, today);
        const isSelected = dateKey === selectedDay;

        return (
          <button
            key={dateKey}
            data-testid={`day-cell-${dateKey}`}
            data-today={isToday ? "true" : undefined}
            data-selected={isSelected ? "true" : undefined}
            className={cn(
              "day-cell flex flex-col items-center gap-1 rounded-lg py-2 text-sm text-on-surface transition-colors",
              isToday && "ring-2 ring-primary",
              isSelected && "bg-surface-container-high",
              !isSelected && "hover:bg-surface-container"
            )}
            onClick={() => onDayClick(dateKey)}
          >
            <span>{day.getDate()}</span>
            {count === 1 && (
              <span
                data-testid="reminder-dot"
                className="h-2 w-2 rounded-full bg-primary"
              />
            )}
            {count > 1 && (
              <span
                data-testid="reminder-count"
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-on-primary"
              >
                {count > 9 ? "9+" : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
