export function RemindersView() {
  const now = new Date();
  const headerText = now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div data-testid="reminders-page" className="flex flex-1 flex-col">
      <div className="bg-surface-container px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <h2
            data-testid="reminders-header"
            className="text-lg font-semibold text-on-surface"
          >
            {headerText}
          </h2>
        </div>
      </div>
    </div>
  );
}
