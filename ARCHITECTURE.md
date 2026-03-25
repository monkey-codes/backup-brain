# Backup Brain — Architecture

## Vision

A personal AI memory system where humans capture thoughts through a web app, and an autonomous agent classifies, organizes, and proactively surfaces insights from that data.

## System Components

```
┌──────────────┐                  ┌──────────────┐
│   Web App    │                  │    Agent     │
│ Vite+React   │                  │   Process    │
│  TypeScript  │                  │  (Node.js)   │
└──────┬───────┘                  └──┬───────┬───┘
       │ Supabase JS SDK             │       │
       │ (write messages,            │       │ MCP Client
       │  subscribe to responses,    │       │ (@modelcontextprotocol/sdk)
       │  correct decisions)         │       │
       │                             │       │
       │    ┌───────────────┐        │       │
       └────┤   Supabase    ├────────┘   ┌───┴───────┐
            │  (PostgreSQL  │            │ MCP Server │
            │  + pgvector   │            │ (Supabase  │
            │  + Realtime)  ├────────────┤  Edge Fn)  │
            └───────────────┘            └───────────┘
```

- **Web App (Vite + React + TypeScript)** — human interface for chatting with the agent, reviewing decisions, correcting mistakes. Writes user messages to `chat_messages`, subscribes to agent responses via Supabase Realtime. Corrects decisions directly via Supabase JS SDK. Deployed to AWS S3 + CloudFront.
- **Agent Process (Node.js + TypeScript)** — subscribes to new user messages via Supabase Realtime, processes them via OpenAI, writes responses back to `chat_messages`. Uses MCP client to read/write thoughts and decisions. Deployed to AWS App Runner.
- **MCP Server (Supabase Edge Function + TypeScript/Deno)** — the agent's interface to Supabase data for thoughts, decisions, search, groups, and notifications. Kept as a separate layer for pluggability — any MCP-compatible client (Claude Desktop, ChatGPT, etc.) can connect in the future.
- **Supabase** — shared bus between app and agent; they never talk directly. All chat communication flows through the database via Supabase Realtime.

## Tech Stack

| Component | Technology |
|---|---|
| Web app | Vite + React + TypeScript |
| Agent process | Node.js + TypeScript |
| MCP server | Supabase Edge Functions (Deno + TypeScript) |
| LLM | OpenAI (gpt-4o) via OpenAI SDK |
| Embeddings | OpenAI text-embedding-3-small (1536 dimensions) |
| Database | Supabase (PostgreSQL + pgvector + Realtime) |
| Auth | Supabase Auth (email/password) |
| MCP client | @modelcontextprotocol/sdk |
| Agent hosting | AWS App Runner |
| Web hosting | AWS S3 + CloudFront |
| Binary management | mise |
| Task runner | Taskfile (go-task) — delegates to package.json scripts per package |
| Local dev | Supabase CLI (local Postgres, Auth, Realtime, Edge Functions via Docker) |

## Developer Tooling

- **mise** — controls binary dependencies (Node.js, Deno, Supabase CLI, etc.). Ensures consistent versions across dev machines via a checked-in `.mise.toml`.
- **Taskfile (go-task)** — provides high-level monorepo tasks that delegate to per-package `package.json` scripts when appropriate. Single entry point for common operations (dev, build, test, deploy).

## Multi-user Model

Multiple users (e.g. you and your partner) share the same database. No data segregation. Auth via Supabase Auth with email/password. Accounts created manually in the Supabase dashboard.

RLS enabled on all tables with a single policy: `auth.uid() IS NOT NULL`. This blocks unauthenticated access while allowing both users full read/write access. The agent uses the service role key, which bypasses RLS.

## Core Schema

Hand-written SQL migrations managed via Supabase CLI. Applied to both local and production environments.

### `thoughts`

Agent-synthesized summaries of information worth persisting. Not raw user messages — the agent distills the key information into standalone, searchable text. A thought is created when the agent judges that a user's input contains information worth capturing to long-term memory. A chat may produce zero, one, or multiple thoughts.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `content` | text | Agent-synthesized thought |
| `embedding` | vector(1536) | OpenAI text-embedding-3-small, for semantic search |
| `session_id` | FK to chat_sessions | Which conversation produced this thought |
| `created_by` | FK to auth.users | Which user's input led to this |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

No `metadata` JSONB column. All structured data lives in `thought_decisions`.

### `thought_decisions`

Every decision the agent makes, stored explicitly. One row per decision — a thought with three entities gets three separate decision rows, each with its own ID, confidence, and correction status.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `thought_id` | FK to thoughts | Many decisions per thought |
| `decision_type` | text | `classification`, `entity`, `reminder`, `tag` |
| `value` | jsonb | Decision payload (see shapes below) |
| `confidence` | float | 0.0–1.0 |
| `reasoning` | text | One sentence explaining why |
| `review_status` | text | `pending`, `accepted`, `corrected` |
| `corrected_value` | jsonb | Null until user overrides |
| `corrected_by` | FK to auth.users | |
| `corrected_at` | timestamptz | |
| `created_at` | timestamptz | |

Corrections are preserved alongside original decisions for the agent to learn from.

**Decision value shapes:**

```jsonc
// classification — one per thought
{ "category": "Home Maintenance" }

// entity — one decision per extracted entity
{ "name": "John", "type": "person" }

// reminder — one per thought (if time-sensitive)
{ "due_at": "2026-04-01T09:00:00Z", "description": "Call the plumber" }

// tag — one decision per tag
{ "label": "urgent" }
```

**Categories** are freeform strings, not a fixed enum. The agent is instructed to prefer a seed list of common categories but can create new ones when nothing fits. The proactive reviewer consolidates duplicates over time.

### `thought_groups`

Clusters of related thoughts. Many-to-many relationship.

- Created and maintained by the proactive reviewer, not at ingestion time
- Agent can split, merge, rename groups as more data arrives

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | Group name |
| `description` | text | Agent-generated summary |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `thought_group_members`

Join table for the many-to-many relationship between thoughts and groups.

| Column | Type | Purpose |
|---|---|---|
| `thought_id` | FK to thoughts | |
| `group_id` | FK to thought_groups | |
| `added_at` | timestamptz | |

### `notifications`

Agent writes here, app reads here.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | FK to auth.users | Who this is for |
| `type` | text | `reminder`, `suggestion`, `insight` |
| `title` | text | Short summary |
| `body` | text | Full notification content |
| `thought_id` | FK to thoughts (nullable) | Related thought, if any |
| `decision_id` | FK to thought_decisions (nullable) | Related decision, if any |
| `delivered_via` | text (nullable) | Future: `email`, `slack`, etc. |
| `read_at` | timestamptz (nullable) | User opened it |
| `dismissed_at` | timestamptz (nullable) | User dismissed it |
| `created_at` | timestamptz | |

`read_at` and `dismissed_at` are both kept — a notification can be seen but still in the list until explicitly cleared. Badge shows count where `read_at IS NULL`. List shows everything where `dismissed_at IS NULL`.

> **Future enhancement:** Add external delivery channels (email, Slack webhook, Telegram bot) for time-sensitive reminders that need to reach users when the app isn't open. The `delivered_via` column supports this without schema changes.

### `chat_sessions`

Each conversation between a user and the agent.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | FK to auth.users | |
| `title` | text (nullable) | Agent-generated after first exchange, user-editable |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Sessions are created by the web app when the user clicks "New Chat." The agent generates a title after the first exchange (user message + agent response) as part of the same LLM call that produces the response.

### `chat_messages`

Individual messages within a chat session.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `session_id` | FK to chat_sessions | |
| `role` | text | `user`, `assistant` |
| `content` | text | Message text |
| `created_at` | timestamptz | |

The web app writes user messages and subscribes to new assistant messages via Supabase Realtime. The agent subscribes to new user messages and writes assistant responses. Short-term memory is the current chat session; long-term memory is the thoughts database, accessed via MCP tools.

## Reminders

Not a separate concept. A reminder is a thought where the agent detects temporal intent and creates a `reminder` decision. Reviewable and correctable like any other decision. The reminder checker cron queries `thought_decisions WHERE decision_type = 'reminder'` — this is a pure SQL query, no LLM call.

## MCP Server Tools

The MCP server exposes these tools via the MCP protocol. Authenticated with the Supabase service role key.

| Tool | Purpose |
|---|---|
| `capture_thought` | Create thought + embedding + decisions atomically. Returns thought ID and all decision IDs. |
| `update_thought` | Modify an existing thought + regenerate embedding (agent refines during conversation) |
| `search_thoughts` | Semantic similarity search (generates query embedding, calls `match_thoughts`) |
| `list_thoughts` | Browse/filter recent thoughts |
| `create_decision` | Add a decision to an existing thought (used by proactive reviewer) |
| `update_decision` | Correct/accept a decision by ID (used by agent during chat corrections) |
| `list_decisions` | Query decisions (e.g., pending reminders, low-confidence) |
| `create_group` | Create/update thought groups |
| `create_notification` | Surface an insight/reminder/suggestion to the user |

`capture_thought` is atomic — it accepts thought text plus an array of decisions, generates the embedding, inserts the thought, and inserts all decisions in a single database transaction. Returns the created IDs so the agent can reference specific decisions later:

```json
{
  "thought_id": "uuid",
  "decisions": [
    { "id": "uuid", "decision_type": "classification", "value": {"category": "Home Maintenance"} },
    { "id": "uuid", "decision_type": "entity", "value": {"name": "plumber", "type": "person"} },
    { "id": "uuid", "decision_type": "reminder", "value": {"due_at": "...", "description": "..."} }
  ]
}
```

Decision corrections happen through two independent paths:
1. **During chat** — user tells the agent, agent calls `update_decision` via MCP
2. **Via review UI** — user corrects directly in the web app via Supabase JS SDK

Both paths write to the same columns (`review_status`, `corrected_value`, `corrected_by`, `corrected_at`).

## Agent Architecture

### Message Intents

All user input goes through the agent via chat. The agent determines intent implicitly through tool selection — no separate classification step:

| Intent | Description | Tools called |
|---|---|---|
| **Capture** | Input contains information worth persisting | `capture_thought` |
| **Query** | User is asking to recall past information | `search_thoughts`, `list_thoughts` |
| **Command** | User is correcting a decision or giving an instruction | `update_decision`, `update_thought` |
| **Conversation** | Chitchat, acknowledgments, no action needed | None |

### ReAct Loop (Single LLM Call Pattern)

The agent uses a single-call ReAct loop per turn. The full set of MCP tools is provided to OpenAI as tool definitions. The model decides which tools to call (if any) based on the conversation. No separate intent classification step — tool selection *is* the intent.

```
User message arrives via Supabase Realtime
→ Agent loads session history from chat_messages
→ Agent sends messages + tool definitions to OpenAI
→ OpenAI responds with text and/or tool calls
→ Agent executes tool calls against MCP server via MCP client
→ Agent sends tool results back to OpenAI
→ OpenAI responds with final text (+ session title on first exchange)
→ Agent writes complete response to chat_messages
```

Responses are written as complete messages (no streaming for MVP). The web app shows a "thinking..." indicator between sending a message and receiving the response.

### Concurrency

- **Sequential per session** — messages within the same session are processed one at a time. If a second message arrives while the first is being processed, it queues.
- **Concurrent across sessions** — different sessions process in parallel.
- Implemented via in-memory locks per session ID in the agent process.

### Startup Recovery

On startup, before subscribing to Realtime, the agent queries for unanswered messages:

```sql
SELECT cm.* FROM chat_messages cm
WHERE cm.role = 'user'
AND NOT EXISTS (
  SELECT 1 FROM chat_messages resp
  WHERE resp.session_id = cm.session_id
  AND resp.role = 'assistant'
  AND resp.created_at > cm.created_at
)
ORDER BY cm.created_at ASC
```

These are processed in order, then the Realtime subscription starts for new messages.

### Realtime Subscriptions

| Subscriber | Table | Event | Filter |
|---|---|---|---|
| Web app | `chat_messages` | INSERT | `session_id = current session` |
| Agent | `chat_messages` | INSERT | `role = 'user'` |

The agent does not subscribe to decision corrections — it reads past corrections as context when making future decisions. The proactive reviewer naturally picks up corrections every 6 hours.

### Error Handling

When a failure occurs (OpenAI API down, MCP server error, embedding generation failure):

1. Retry once with a short delay
2. If still failing, write an error message to `chat_messages` (role = `assistant`) so the user sees feedback
3. The user's original message is preserved — they can see what didn't get processed

No dead letter queue or retry infrastructure for MVP. If the agent process crashes, messages queue up in Supabase and are processed on restart via startup recovery.

### Scheduled Jobs

```
Agent Process
│
├── Supabase Realtime subscription (chat_messages, role=user)
│
└── Scheduled jobs (node-cron)
    ├── Every 1m → Reminder checker (SQL-only, no LLM call)
    └── Every 6h → Proactive reviewer (two-pass: SQL candidates, then LLM)
```

### Reminder Checker (every 1 minute)

Pure SQL query — no LLM call. Queries for due reminders that haven't already fired:

```sql
SELECT td.* FROM thought_decisions td
WHERE td.decision_type = 'reminder'
  AND td.value->>'due_at' <= now()
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.decision_id = td.id
  )
```

Creates `notification` rows (type = `reminder`, `decision_id` linked) for each match. The `NOT EXISTS` check against `notifications` prevents duplicate firings — no additional columns or status flags needed. Notifications are in-app only for MVP.

### Proactive Reviewer (every 6 hours)

Two-pass approach to avoid sending all thoughts to the LLM:

**Pass 1 — SQL candidate selection:**
- Low-confidence decisions: `WHERE confidence < 0.7 AND review_status = 'pending'`
- Ungrouped thoughts: `WHERE id NOT IN (SELECT thought_id FROM thought_group_members)`
- Recent corrections: `WHERE review_status = 'corrected' AND created_at > last_run`

**Pass 2 — LLM processing** of candidates only:
- **Reclassification** — fix low-confidence or corrected-pattern classifications
- **Grouping** — cluster related thoughts (needs broader context, can regroup over time)
- **Insights** — surface suggestions, patterns, forgotten follow-ups → creates notifications

Per-run thought cap to control cost.

## Embedding Flow

Embeddings are generated by the MCP server (Edge Function) when `capture_thought` or `search_thoughts` is called:

```
capture_thought:
  → MCP server receives thought text + decisions
  → Calls OpenAI text-embedding-3-small API to generate embedding
  → Inserts thought row with content + embedding
  → Inserts decision rows
  → Returns IDs

update_thought:
  → MCP server receives thought ID + updated text
  → Calls OpenAI text-embedding-3-small API to regenerate embedding
  → Updates thought row with new content + new embedding
  → Returns updated thought ID

search_thoughts:
  → MCP server receives query text
  → Calls OpenAI to generate query embedding
  → Calls match_thoughts(query_embedding, ...) in PostgreSQL
  → Returns ranked results
```

Once an embedding dimension (1536) is chosen, changing it requires re-embedding all existing thoughts. This is a one-way door.

## Decision Review UX

- Everything auto-settles. No blocking queue.
- Confidence score stored on every decision.
- "Needs review" filter: decisions where `confidence < threshold` and `review_status = 'pending'`.
- User can accept or correct any decision. Corrections feed back into the agent's future reasoning.
- Two correction paths: in-chat (via agent) and in-UI (direct to Supabase). Both write to the same columns.

## LLM Abstraction

```typescript
interface LLMProvider {
  chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse>
}
```

OpenAI first (gpt-4o for reasoning, gpt-4o-mini as an option for cheaper calls like title generation). Easy to add Anthropic or others behind the same interface if API access is acquired later.

## Web App Views (MVP)

| View | Purpose |
|---|---|
| **Login** | Email/password auth via Supabase Auth |
| **Chat** | Main interface — session list sidebar + message area. Session created on "New Chat" click. |
| **Notifications** | List of reminders, suggestions, insights. Badge for unread. |
| **Decision Review** | Browse decisions, filter by low confidence/pending, accept or correct |

## Project Structure

Monorepo with npm workspaces. Shared TypeScript types between web app and agent.

```
open-brain/
├── packages/
│   ├── web/          # Vite + React + TypeScript app
│   ├── agent/        # Node.js + TypeScript agent process
│   └── shared/       # Shared types (ChatMessage, Thought, Decision, etc.)
├── supabase/
│   ├── functions/    # Edge Functions (MCP server)
│   └── migrations/   # Hand-written SQL migrations
├── package.json      # Workspace root
└── tsconfig.base.json
```

The `shared` package contains database-facing types used by both web app and agent: `ChatSession`, `ChatMessage`, `Thought`, `ThoughtDecision`, `DecisionType`, `ThoughtGroup`, `Notification`. The `LLMProvider` interface lives in the `agent` package — only the agent calls LLMs.

## Deployment

| Component | Production | Local Dev |
|---|---|---|
| Agent process | AWS App Runner | `npm run dev` in packages/agent |
| Web app | AWS S3 + CloudFront | Vite dev server |
| MCP server | Supabase Edge Functions | Supabase CLI local |
| Database | Supabase (hosted) | Supabase CLI local (Docker) |
| Scheduler | node-cron in agent | node-cron in agent |

Environment variables switch between local and production. Same codebase, same architecture — only deployment targets change.

## Observability (MVP)

Structured console logs from the agent process with consistent format (timestamp, session_id, action). AWS App Runner captures stdout to CloudWatch automatically. No additional observability infrastructure for MVP.

## Cost Guardrails

- **Per-message LLM calls** — user-driven, inherently bounded by usage
- **Reminder checker** — SQL-only, no LLM cost
- **Proactive reviewer** — per-run thought cap prevents unbounded token usage
- **Embeddings** — OpenAI text-embedding-3-small is low cost (~$0.02/1M tokens)

## Key Design Decisions

- **Supabase as shared bus** — app and agent are fully decoupled, communicate only through the database via Supabase Realtime. No direct HTTP calls between them. This means the agent can be down and messages queue up, and the architecture works identically in local dev and cloud deployment.
- **MCP server retained for pluggability** — any MCP-compatible client can connect to the same thought store in the future. The agent is one consumer, not the only consumer.
- **Multiple chat sessions per user** — each conversation is a separate session with its own message history. The current session is the agent's short-term memory (sent as LLM context). Cross-session context comes from the thoughts database via MCP tools (semantic search, not chat history).
- **All input goes through the agent** — no separate capture path; the agent handles every user message, decides what to do, and responds. Thought capture + classification happens in the same chat turn.
- **Thoughts are agent-synthesized** — not raw user messages. The agent distills information into standalone, searchable summaries. Raw conversation is always available in `chat_messages`.
- **Decisions are first-class data** — not side effects, stored with confidence and reasoning, individually addressable by ID, reviewable and correctable.
- **One decision per extracted item** — each entity, tag, reminder gets its own row with its own confidence and correction status. No arrays in JSONB.
- **Auto-settle everything** — zero friction for capture, review is optional.
- **Grouping is a periodic activity, not per-thought** — needs broader context, agent can regroup as data evolves.
- **Classification categories are freeform with a seed list** — no fixed enum. Agent prefers known categories but can create new ones. Proactive reviewer consolidates duplicates.
- **Reminders are just thoughts with temporal decisions** — no separate concept.
- **Complete responses, no streaming** — agent writes full response as a single insert. Web app shows "thinking..." indicator.
- **Sequential per session, concurrent across sessions** — prevents interleaving within a conversation while allowing parallel processing.

## Build Order

1. Supabase schema (thoughts, thought_decisions, thought_groups, thought_group_members, notifications, chat_sessions, chat_messages)
2. MCP server — Edge Function with all tools
3. Agent core — chat handler with ReAct loop, MCP client, startup recovery
4. Web app — chat UI (primary interface for all interaction)
5. Web app — decision review with accept/correct
6. Web app — notifications view
7. Scheduler — reminder checker + proactive reviewer
8. Feedback loop — agent reads past corrections to improve future decisions

## Alignment with Agentic AI Design Patterns

### Aligned

| Pattern | How It Maps |
|---|---|
| **ReAct** (Reason + Act) | Chat handler: agent receives input → reasons about it → acts via MCP tools → observes result → responds |
| **Tool Use** | MCP server provides clean tool boundaries; agent decides which tools to call and when |
| **Simplicity** | Single agent, no framework (LangChain, CrewAI, etc.) — simple, composable patterns |
| **Auditability** | `thought_decisions` with confidence scores and reasoning — controllable, debuggable agent with human approvals |
| **Memory** | Three-tier memory: short-term (chat_messages), long-term (thoughts + decisions), episodic (correction history) |

### Intentional Divergences (Fine for MVP)

| Pattern | Status | Rationale |
|---|---|---|
| **Multi-Agent** | Single agent | Multi-agent adds coordination complexity not worth it for a solo build. The clean split between chat-time processing and proactive review means the reviewer could later be extracted into a separate agent without restructuring. |
| **Plan-and-Execute** | No explicit planning step | Classification and chat are single-step actions that don't need it. The proactive reviewer may benefit from planning later (e.g., "I have 50 ungrouped thoughts, let me plan how to cluster them"). |
| **Reflection** | Not included | Confidence scores serve a similar purpose. A lightweight self-evaluation step ("does this classification make sense given similar past thoughts?") could be added later as a single extra LLM call. |

## Future Considerations

### Reflection Step

Add a second LLM call after classification to self-evaluate: "does this make sense given past corrections and similar thoughts?" Targeted at classification only (highest-stakes decision type). Includes recent user corrections as few-shot context, improving naturally over time. No architectural change — just an additional LLM call inside the existing chat handler.

### External Notification Channels

Add delivery to external channels (email, Slack webhook, Telegram bot) for time-sensitive reminders. The `delivered_via` column on `notifications` already supports this. A "notification dispatcher" component would check notification type/urgency and route to the appropriate channel. No schema changes required.

### Agent Memory

The proactive reviewer currently has no memory across cycles — it re-derives everything from the data each run. This works for MVP but becomes expensive as data grows. A future `agent_memory` table would let the agent persist observations between review cycles:

- Emerging patterns ("seeing many plumbing thoughts — recurring issue?")
- Self-corrections ("I keep miscategorizing job-search as CRM")
- User behaviour observations ("meal planning thoughts tend to come on Sundays")
- Deferred actions ("not enough data to group these yet, revisit next cycle")

Each memory would have a lifecycle: `active` → `resolved` (led to an action) or `expired` (aged out). The agent maintains this itself — at the start of each proactive review cycle, it loads active memories, resolves or expires stale ones, does the review, and writes new observations. A hard cap (e.g., 50 active memories) prevents unbounded growth by forcing the agent to resolve or expire old entries before adding new ones.

### Duplicate Thought Detection

If both users discuss the same topic in separate chats, the agent might create duplicate thoughts. The proactive reviewer can detect and merge these via semantic similarity during its grouping pass. No special handling needed at capture time.
