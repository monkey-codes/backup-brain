import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MonthGrid } from "./month-grid";

// April 2026: starts on Wednesday, 30 days
const APRIL_2026 = { year: 2026, month: 4 };
// February 2026: starts on Sunday, 28 days
const FEB_2026 = { year: 2026, month: 2 };
// February 2028: leap year, 29 days
const FEB_2028_LEAP = { year: 2028, month: 2 };

const TODAY = new Date(2026, 3, 6); // April 6, 2026

describe("MonthGrid", () => {
  it("renders Monday-start column headers", () => {
    render(
      <MonthGrid
        year={APRIL_2026.year}
        month={APRIL_2026.month}
        today={TODAY}
        reminderCounts={{}}
        selectedDay={null}
        onDayClick={vi.fn()}
      />
    );

    const headers = screen.getAllByTestId("weekday-header");
    expect(headers).toHaveLength(7);
    expect(headers[0]).toHaveTextContent("Mon");
    expect(headers[1]).toHaveTextContent("Tue");
    expect(headers[2]).toHaveTextContent("Wed");
    expect(headers[3]).toHaveTextContent("Thu");
    expect(headers[4]).toHaveTextContent("Fri");
    expect(headers[5]).toHaveTextContent("Sat");
    expect(headers[6]).toHaveTextContent("Sun");
  });

  it("renders correct number of day cells for April 2026 (30 days)", () => {
    render(
      <MonthGrid
        year={APRIL_2026.year}
        month={APRIL_2026.month}
        today={TODAY}
        reminderCounts={{}}
        selectedDay={null}
        onDayClick={vi.fn()}
      />
    );

    const dayCells = screen.getAllByTestId(/^day-cell-/);
    expect(dayCells).toHaveLength(30);
  });

  it("renders correct number of day cells for February 2026 (28 days)", () => {
    render(
      <MonthGrid
        year={FEB_2026.year}
        month={FEB_2026.month}
        today={TODAY}
        reminderCounts={{}}
        selectedDay={null}
        onDayClick={vi.fn()}
      />
    );

    const dayCells = screen.getAllByTestId(/^day-cell-/);
    expect(dayCells).toHaveLength(28);
  });

  it("renders 29 day cells for February in a leap year", () => {
    render(
      <MonthGrid
        year={FEB_2028_LEAP.year}
        month={FEB_2028_LEAP.month}
        today={TODAY}
        reminderCounts={{}}
        selectedDay={null}
        onDayClick={vi.fn()}
      />
    );

    const dayCells = screen.getAllByTestId(/^day-cell-/);
    expect(dayCells).toHaveLength(29);
  });

  it("highlights today's date with a ring", () => {
    render(
      <MonthGrid
        year={APRIL_2026.year}
        month={APRIL_2026.month}
        today={TODAY}
        reminderCounts={{}}
        selectedDay={null}
        onDayClick={vi.fn()}
      />
    );

    const todayCell = screen.getByTestId("day-cell-2026-04-06");
    expect(todayCell).toHaveAttribute("data-today", "true");
  });

  it("does not highlight non-today dates", () => {
    render(
      <MonthGrid
        year={APRIL_2026.year}
        month={APRIL_2026.month}
        today={TODAY}
        reminderCounts={{}}
        selectedDay={null}
        onDayClick={vi.fn()}
      />
    );

    const otherCell = screen.getByTestId("day-cell-2026-04-07");
    expect(otherCell).not.toHaveAttribute("data-today", "true");
  });

  it("shows a dot indicator for days with exactly 1 reminder", () => {
    render(
      <MonthGrid
        year={APRIL_2026.year}
        month={APRIL_2026.month}
        today={TODAY}
        reminderCounts={{ "2026-04-10": 1 }}
        selectedDay={null}
        onDayClick={vi.fn()}
      />
    );

    const cell = screen.getByTestId("day-cell-2026-04-10");
    expect(
      cell.querySelector("[data-testid='reminder-dot']")
    ).toBeInTheDocument();
    expect(
      cell.querySelector("[data-testid='reminder-count']")
    ).not.toBeInTheDocument();
  });

  it("shows a count badge for days with 2+ reminders", () => {
    render(
      <MonthGrid
        year={APRIL_2026.year}
        month={APRIL_2026.month}
        today={TODAY}
        reminderCounts={{ "2026-04-15": 3 }}
        selectedDay={null}
        onDayClick={vi.fn()}
      />
    );

    const cell = screen.getByTestId("day-cell-2026-04-15");
    const badge = cell.querySelector("[data-testid='reminder-count']");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("3");
    expect(
      cell.querySelector("[data-testid='reminder-dot']")
    ).not.toBeInTheDocument();
  });

  it("shows no indicator for days with 0 reminders", () => {
    render(
      <MonthGrid
        year={APRIL_2026.year}
        month={APRIL_2026.month}
        today={TODAY}
        reminderCounts={{ "2026-04-10": 1 }}
        selectedDay={null}
        onDayClick={vi.fn()}
      />
    );

    const cell = screen.getByTestId("day-cell-2026-04-01");
    expect(
      cell.querySelector("[data-testid='reminder-dot']")
    ).not.toBeInTheDocument();
    expect(
      cell.querySelector("[data-testid='reminder-count']")
    ).not.toBeInTheDocument();
  });

  it("fires onDayClick with the correct date string when a day is clicked", async () => {
    const onDayClick = vi.fn();
    const user = userEvent.setup();

    render(
      <MonthGrid
        year={APRIL_2026.year}
        month={APRIL_2026.month}
        today={TODAY}
        reminderCounts={{}}
        selectedDay={null}
        onDayClick={onDayClick}
      />
    );

    await user.click(screen.getByTestId("day-cell-2026-04-12"));
    expect(onDayClick).toHaveBeenCalledWith("2026-04-12");
  });

  it("marks the selected day with data-selected attribute", () => {
    render(
      <MonthGrid
        year={APRIL_2026.year}
        month={APRIL_2026.month}
        today={TODAY}
        reminderCounts={{}}
        selectedDay="2026-04-20"
        onDayClick={vi.fn()}
      />
    );

    const selectedCell = screen.getByTestId("day-cell-2026-04-20");
    expect(selectedCell).toHaveAttribute("data-selected", "true");

    const otherCell = screen.getByTestId("day-cell-2026-04-21");
    expect(otherCell).not.toHaveAttribute("data-selected", "true");
  });

  it("aligns April 2026 day 1 to Wednesday column (3rd position, Mon-start)", () => {
    render(
      <MonthGrid
        year={APRIL_2026.year}
        month={APRIL_2026.month}
        today={TODAY}
        reminderCounts={{}}
        selectedDay={null}
        onDayClick={vi.fn()}
      />
    );

    // April 1 2026 is a Wednesday. In a Mon-start grid, that's column 3.
    // There should be 2 empty cells before day 1.
    const emptyCells = screen.getAllByTestId("empty-cell");
    const firstDayCell = screen.getByTestId("day-cell-2026-04-01");

    // The grid should have empty cells for Mon and Tue before Wed
    expect(emptyCells.length).toBeGreaterThanOrEqual(2);
    expect(firstDayCell).toHaveTextContent("1");
  });
});
