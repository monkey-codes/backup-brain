import { useMemo, useState } from "react";
import { addMonths, subMonths } from "date-fns";
import { useReminders, type RemindersByDay } from "./use-reminders";
import { MonthGrid } from "./month-grid";
import { DayDetail } from "./day-detail";

type ViewMode = "grid" | "detail";

export function RemindersView() {
  const today = useMemo(() => new Date(), []);
  const [viewedMonth, setViewedMonth] = useState({
    year: today.getFullYear(),
    month: today.getMonth() + 1, // 1-indexed
  });
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { data: remindersByDay } = useReminders(
    viewedMonth.year,
    viewedMonth.month
  );

  const headerText = new Date(
    viewedMonth.year,
    viewedMonth.month - 1
  ).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  function handlePrevMonth() {
    const d = subMonths(new Date(viewedMonth.year, viewedMonth.month - 1), 1);
    setViewedMonth({ year: d.getFullYear(), month: d.getMonth() + 1 });
    setSelectedDay(null);
  }

  function handleNextMonth() {
    const d = addMonths(new Date(viewedMonth.year, viewedMonth.month - 1), 1);
    setViewedMonth({ year: d.getFullYear(), month: d.getMonth() + 1 });
    setSelectedDay(null);
  }

  function handleToday() {
    setViewedMonth({
      year: today.getFullYear(),
      month: today.getMonth() + 1,
    });
    setSelectedDay(null);
    setViewMode("grid");
  }

  function handleDayClick(dateKey: string) {
    setSelectedDay(dateKey);
    setViewMode("detail");
  }

  function handleBack() {
    setViewMode("grid");
  }

  const reminderCounts: Record<string, number> = {};
  if (remindersByDay) {
    for (const [day, reminders] of Object.entries(remindersByDay)) {
      reminderCounts[day] = reminders.length;
    }
  }

  return (
    <div data-testid="reminders-page" className="flex flex-1 flex-col">
      <div className="bg-surface-container px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <button
            data-testid="month-prev"
            onClick={handlePrevMonth}
            className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-high"
          >
            ‹
          </button>
          <h2
            data-testid="reminders-header"
            className="flex-1 text-center text-lg font-semibold text-on-surface"
          >
            {headerText}
          </h2>
          <button
            data-testid="month-next"
            onClick={handleNextMonth}
            className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-high"
          >
            ›
          </button>
          <button
            data-testid="month-today"
            onClick={handleToday}
            className="rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
          >
            Today
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl">
          {viewMode === "grid" ? (
            <MonthGrid
              year={viewedMonth.year}
              month={viewedMonth.month}
              today={today}
              reminderCounts={reminderCounts}
              selectedDay={selectedDay}
              onDayClick={handleDayClick}
            />
          ) : (
            selectedDay && (
              <DayDetail
                date={selectedDay}
                reminders={remindersByDay?.[selectedDay] ?? []}
                onBack={handleBack}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}
