# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Backup Brain is an AI memory system — a chat interface where an agent extracts, classifies, and recalls user thoughts using semantic search. Built as a pnpm monorepo with three packages plus Supabase infrastructure.

## Commands

All commands use [go-task](https://taskfile.dev) (`task`). Binary versions managed by mise (`.mise.toml`).

```bash
task install              # pnpm install
task dev                  # Start all dev servers (web + agent + edge functions)
task typecheck            # Type-check all packages
task test:agent           # Run agent tests (vitest)
task test:web             # Run web tests (vitest)
task test:mcp             # MCP integration tests (deno test, requires db:start + dev:functions)
task db:start             # Start local Supabase (Postgres, Auth, Realtime, Studio)
task db:reset             # Reset database (reapply all migrations)
task db:migration -- name # Create new migration file
```

Single test file: `pnpm -C packages/agent exec vitest run src/some-file.test.ts`

## Architecture

### Packages

- **`packages/shared`** — TypeScript types shared across packages (database entities, decision types, review status). No runtime code.
- **`packages/web`** — React 19 + Vite frontend. Tailwind 4, React Router 7, TanStack Query. Path alias `@/*` maps to `src/*`.
- **`packages/agent`** — Node.js agent process. Uses OpenAI SDK (gpt-4o) with ReAct loop pattern, consuming tools from the MCP server. Runs scheduled jobs via node-cron.
- **`supabase/functions/mcp`** — Deno Edge Function exposing 8 MCP tools (Hono framework, Zod validation). Tools: `capture_thought`, `update_thought`, `search_thoughts`, `list_thoughts`, `create_decision`, `update_decision`, `list_decisions`, `create_notification`.

### Communication Pattern

Web and agent never talk directly. All communication flows through Supabase:

```
Web App ←→ Supabase (DB + Realtime) ←→ Agent Process
                    ↕
              MCP Edge Function
```

- User sends message → written to `chat_messages` → agent picks up via Realtime subscription
- Agent processes with ReAct loop (reason → call MCP tools → respond) → writes assistant message to DB
- Web app receives response via Realtime subscription

### Key Agent Patterns

- **Session locking**: Sequential processing per session, concurrent across sessions (`session-lock.ts`)
- **Startup recovery**: On boot, processes any unanswered user messages before subscribing to Realtime
- **Scheduler**: Reminder checker (every 1 min, SQL-only) and proactive reviewer (every 6 hrs, LLM-based)
- **Correction feedback**: Agent reads past user corrections from `thought_decisions` before making new decisions

### Database

PostgreSQL 17 with pgvector extension. Schema in `supabase/migrations/`. Key tables: `chat_sessions`, `chat_messages`, `thoughts` (with 1536-dim embeddings), `thought_decisions`, `thought_groups`, `notifications`. RLS enabled. Similarity search via `match_thoughts()` PL/pgSQL function.

### Environment Variables

Agent requires: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`. Optional: `MCP_URL` (default: local), `HEALTH_PORT` (default: 3001).
Web requires: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## TypeScript

- Strict mode everywhere. Base config in `tsconfig.base.json` (ES2022, bundler module resolution).
- Agent uses TypeScript project references to consume `@backup-brain/shared`.
- Web and agent test with Vitest. Web uses jsdom environment + React Testing Library.

## Reference

`ARCHITECTURE.md` contains the full system design document including schema details, deployment topology, and design decisions.
