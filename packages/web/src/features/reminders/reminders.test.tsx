import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { RemindersView } from "./reminders";

function renderReminders() {
  return render(
    <MemoryRouter>
      <RemindersView />
    </MemoryRouter>
  );
}

describe("RemindersView", () => {
  it("renders a header with the current month and year", () => {
    renderReminders();

    const now = new Date();
    const expectedHeader = now.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    expect(screen.getByTestId("reminders-header")).toHaveTextContent(
      expectedHeader
    );
  });

  it("renders the reminders page shell", () => {
    renderReminders();

    expect(screen.getByTestId("reminders-page")).toBeInTheDocument();
  });
});
