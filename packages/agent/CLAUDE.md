# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                  # Start agent with tsx watch (auto-reload)
pnpm build                # TypeScript compilation to dist/
pnpm typecheck            # Type-check only (tsc -b)
pnpm test                 # Run all tests once (vitest run)
pnpm test:watch           # Watch mode
```

Single test file: `pnpm exec vitest run src/__tests__/some-file.test.ts`

From monorepo root: `task test:agent` or `pnpm -C packages/agent exec vitest run src/some-file.test.ts`

## Architecture

### ReAct Loop (`react-loop-executor.ts`)

The core processing engine. Each user message triggers a loop (max 10 rounds):

1. Send messages + tool definitions to LLM
2. If LLM returns `finish_reason="stop"` -> return response
3. If `tool_calls` exist: parse args, inject embeddings/session context, execute via MCP, append results to history
4. Continue to next round

Key mechanisms:
- **Schema rewriting**: Infrastructure params (`session_id`, `embedding`) are hidden from the LLM. The executor auto-injects them via `argInjections` and converts text fields to embeddings before calling MCP tools.
- **Tool filtering**: `toolFilter: Set<string>` restricts which tools the LLM can see (used by proactive reviewer to limit to review-only tools).
- **Error recovery**: Tool failures are serialized to JSON and passed back to the LLM as tool results, letting it reason about and recover from errors.

### Message Processing Flow

1. **Startup** (`startup.ts`): `recoverUnanswered()` finds sessions where the last message is from the user with no assistant response. Processes them chronologically before subscribing to Realtime.
2. **Realtime subscription** (`index.ts`): Listens for INSERT events on `chat_messages`. On new user message, acquires session lock and runs ReAct loop.
3. **Context building** (`chat-context-loader.ts`): Loads message history, session metadata, and past corrections. Builds dynamic system prompt with current date/time and correction feedback from `prompts/system.md`.

### Session Locking (`session-lock.ts`)

Per-session mutex using Promise chaining. Sequential within a session, concurrent across sessions. Prevents race conditions when multiple messages arrive for the same session.

### Scheduler (`scheduler.ts`)

Two cron jobs:
- **Reminder checker** (every 1 min): Pure SQL via RPC `get_due_reminders()`. Finds due reminders and creates notification records. No LLM calls.
- **Proactive reviewer** (every 6 hrs): Two-pass — SQL selects candidates (low-confidence decisions < 0.7, corrected decisions, max 50), then LLM reclassifies/groups/generates insights using a filtered tool set.

### MCP Client (`mcp-client.ts`)

Thin JSON-RPC 2.0 client over HTTP to the Supabase Edge Function. Methods: `initialize()`, `listTools()`, `callTool(name, args)`. Protocol version `2025-03-26`.

### LLM Provider (`llm-provider.ts`)

Wraps OpenAI SDK. Two capabilities: chat completions (gpt-4o) and embeddings (text-embedding-3-small, 1536 dims). Abstracts message formatting and tool serialization.

## Testing Patterns

- Vitest with `globals: true` and `restoreMocks: true` (auto-cleanup)
- All external dependencies mocked with `vi.mock()` / `vi.fn()`
- Supabase mocked with chainable builders (`.from().select().eq().order()` returns mock data)
- Tests cover: ReAct loop rounds, tool execution, embedding injection, argument injection, startup recovery, scheduler logic, context loading
