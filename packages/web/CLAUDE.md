# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                  # Vite dev server
pnpm build                # Type-check + Vite build (tsc -b && vite build)
pnpm typecheck            # Type-check only (tsc -b)
pnpm test                 # Run all tests once (vitest run)
pnpm test:watch           # Watch mode
```

From monorepo root: `task test:web`

## Architecture

### Routing (React Router 7)

Layout routes in `App.tsx`:

- **Auth layout** (minimal, no shell): `/login` -> `LoginView`
- **App layout** (full shell, protected): `/chat`, `/chat/:sessionId`, `/review`, `/notifications`, `/reminders`
- `/` and `*` redirect to `/chat`

`ProtectedRoute` checks `useAuth()` and redirects unauthenticated users to `/login`.

Chat sessions are URL-driven: `/chat/:sessionId` loads a session from the URL param. `/chat` (no param) shows an empty state. Session identity comes from `useParams()`, not React context.

### State Management

**TanStack Query** for all server state. Query keys:

- `["chat_sessions"]` — session list
- `["chat_messages", sessionId]` — messages for a session
- `"thought_decisions"` — decision review data
- `"notifications"` — notification list

**React Context** for UI state:

- `AuthProvider` (`use-auth.tsx`) — Supabase session, `signIn()`, `signOut()`

**Mutations** use optimistic updates: create temporary entries (e.g., `"optimistic-${Date.now()}"`), rollback on error via `onError` with saved previous state.

### Realtime Subscriptions

Hooks subscribe to Supabase Realtime channels for live updates:

- `useMessages` subscribes to `messages:${sessionId}` channel (INSERT events on `chat_messages`)
- `useNotifications` subscribes to `notifications-realtime` channel
- Both update the TanStack Query cache on new events and deduplicate against existing data
- Channels are cleaned up on unmount via `useEffect` return

### Styling

**Tailwind CSS 4** with Material Design 3 dark theme defined in `src/index.css` via `@theme`. Key tokens: `surface`, `primary`, `on-surface`, `secondary`, `tertiary`, `error` with MD3 elevation tiers (lowest/low/container/high/highest).

Fonts: Inter (body), Space Grotesk (headlines) — loaded from Google Fonts.

Utility: `cn()` in `shared/lib/utils.ts` (clsx + tailwind-merge) for conditional class merging.

`DESIGN.md` contains the full visual design system ("Obsidian Intelligence Framework") with rules for surface layering, typography, elevation, and component styling. Consult it when building or modifying UI components.

### Folder Structure (Feature-based)

- **`app/`** — App shell and wiring: route config (`App.tsx`), layout components (`layouts/`), thin page wrappers (`pages/`), route tests
- **`features/auth/`** — Login page, auth hook/provider (`use-auth.tsx`), protected route, auth tests
- **`features/chat/`** — ChatView component, message and session hooks, chat tests
- **`features/decisions/`** — Decision review page, decision hooks, decision tests
- **`features/notifications/`** — Notifications page, notification hooks, notification tests
- **`shared/ui/`** — Reusable UI primitives (Button, Input, Label) using CVA for variants
- **`shared/lib/`** — Supabase client init (`supabase.ts`), utilities (`utils.ts`)

No barrel files — all imports are direct (e.g., `@/features/chat/use-messages`). Tests live alongside their feature code.

### Path Alias

`@/*` maps to `src/*` (configured in both `tsconfig.json` and `vite.config.ts`).

## Testing Patterns

- Vitest with jsdom environment, `globals: true`
- Setup file: `src/test-setup.ts` (registers jest-dom matchers, mocks `scrollIntoView`)
- Supabase mocked with `vi.mock("@/shared/lib/supabase")` — chainable query builders
- Auth state initialized via `setupAuthMock()` helper in tests
- Interactive elements have `data-testid` attributes
- Uses `@testing-library/react` for rendering + queries, `@testing-library/user-event` for interactions, `waitFor()` for async assertions

### Types

All domain types imported from `@backup-brain/shared` (ChatSession, ChatMessage, Notification, ThoughtDecision, etc.). No local type duplication.
