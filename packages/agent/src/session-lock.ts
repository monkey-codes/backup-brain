// ---------------------------------------------------------------------------
// Per-session mutex — sequential within a session, concurrent across sessions
// ---------------------------------------------------------------------------

type Release = () => void;

export class SessionLock {
  private locks = new Map<string, Promise<void>>();

  async acquire(sessionId: string): Promise<Release> {
    // Wait for any existing work on this session to finish
    const existing = this.locks.get(sessionId) ?? Promise.resolve();

    let release!: Release;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Chain: new work starts after existing work completes
    this.locks.set(sessionId, existing.then(() => next));

    await existing;
    return release;
  }
}
