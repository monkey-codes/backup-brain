import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { DayDetail } from "./day-detail";
import type { Reminder } from "./use-reminders";

const REMINDERS: Reminder[] = [
  {
    id: "r1",
    due_at: "2026-04-10T14:00:00Z",
    description: "Afternoon meeting",
    review_status: "accepted",
  },
  {
    id: "r2",
    due_at: "2026-04-10T09:00:00Z",
    description: "Morning standup",
    review_status: "pending",
  },
  {
    id: "r3",
    due_at: "2026-04-10T18:30:00Z",
    description: "Evening gym",
    review_status: "corrected",
  },
];

describe("DayDetail", () => {
  it("renders reminders sorted by time ascending", () => {
    render(
      <DayDetail date="2026-04-10" reminders={REMINDERS} onBack={vi.fn()} />
    );

    const cards = screen.getAllByTestId("reminder-card");
    expect(cards).toHaveLength(3);
    // 09:00, 14:00, 18:30
    expect(cards[0]).toHaveTextContent("Morning standup");
    expect(cards[1]).toHaveTextContent("Afternoon meeting");
    expect(cards[2]).toHaveTextContent("Evening gym");
  });

  it("shows formatted time for each reminder", () => {
    render(
      <DayDetail date="2026-04-10" reminders={REMINDERS} onBack={vi.fn()} />
    );

    const cards = screen.getAllByTestId("reminder-card");
    expect(cards[0]).toHaveTextContent("9:00 AM");
    expect(cards[1]).toHaveTextContent("2:00 PM");
    expect(cards[2]).toHaveTextContent("6:30 PM");
  });

  it("shows description for each reminder", () => {
    render(
      <DayDetail date="2026-04-10" reminders={REMINDERS} onBack={vi.fn()} />
    );

    expect(screen.getByText("Morning standup")).toBeInTheDocument();
    expect(screen.getByText("Afternoon meeting")).toBeInTheDocument();
    expect(screen.getByText("Evening gym")).toBeInTheDocument();
  });

  it("shows correct review status badge for pending", () => {
    render(
      <DayDetail
        date="2026-04-10"
        reminders={[REMINDERS[1]]}
        onBack={vi.fn()}
      />
    );

    const badge = screen.getByTestId("review-status-badge");
    expect(badge).toHaveTextContent("pending");
  });

  it("shows correct review status badge for accepted", () => {
    render(
      <DayDetail
        date="2026-04-10"
        reminders={[REMINDERS[0]]}
        onBack={vi.fn()}
      />
    );

    const badge = screen.getByTestId("review-status-badge");
    expect(badge).toHaveTextContent("accepted");
  });

  it("shows correct review status badge for corrected", () => {
    render(
      <DayDetail
        date="2026-04-10"
        reminders={[REMINDERS[2]]}
        onBack={vi.fn()}
      />
    );

    const badge = screen.getByTestId("review-status-badge");
    expect(badge).toHaveTextContent("corrected");
  });

  it("renders header with formatted date", () => {
    render(<DayDetail date="2026-04-10" reminders={[]} onBack={vi.fn()} />);

    const header = screen.getByTestId("day-detail-header");
    expect(header).toHaveTextContent("Friday, April 10, 2026");
  });

  it("triggers onBack callback when back button is clicked", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();

    render(<DayDetail date="2026-04-10" reminders={[]} onBack={onBack} />);

    await user.click(screen.getByTestId("day-detail-back"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows empty state when no reminders exist", () => {
    render(<DayDetail date="2026-04-10" reminders={[]} onBack={vi.fn()} />);

    expect(screen.getByTestId("day-detail-empty")).toBeInTheDocument();
    expect(screen.getByTestId("day-detail-empty")).toHaveTextContent(
      "No reminders"
    );
  });
});
