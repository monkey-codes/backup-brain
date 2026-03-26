-- Enable pgvector extension for embedding similarity search
create extension if not exists vector with schema extensions;

-- ============================================================================
-- Tables
-- ============================================================================

-- Chat sessions
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chat messages
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

-- Thoughts (agent-synthesized summaries)
create table public.thoughts (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding extensions.vector(1536),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Thought decisions (classification, entity, reminder, tag)
create table public.thought_decisions (
  id uuid primary key default gen_random_uuid(),
  thought_id uuid not null references public.thoughts(id) on delete cascade,
  decision_type text not null check (decision_type in ('classification', 'entity', 'reminder', 'tag')),
  value jsonb not null,
  confidence float not null check (confidence >= 0.0 and confidence <= 1.0),
  reasoning text not null,
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'corrected')),
  corrected_value jsonb,
  corrected_by uuid references auth.users(id),
  corrected_at timestamptz,
  created_at timestamptz not null default now()
);

-- Thought groups (clusters of related thoughts)
create table public.thought_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Thought group members (many-to-many join table)
create table public.thought_group_members (
  thought_id uuid not null references public.thoughts(id) on delete cascade,
  group_id uuid not null references public.thought_groups(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (thought_id, group_id)
);

-- Notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  type text not null check (type in ('reminder', 'suggestion', 'insight')),
  title text not null,
  body text not null,
  thought_id uuid references public.thoughts(id) on delete set null,
  decision_id uuid references public.thought_decisions(id) on delete set null,
  delivered_via text,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Agent state (key-value store for agent process state)
create table public.agent_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Chat messages: lookup by session, ordered by time
create index idx_chat_messages_session_id on public.chat_messages(session_id, created_at);

-- Chat messages: agent startup recovery query (find unanswered user messages)
create index idx_chat_messages_role on public.chat_messages(role, created_at);

-- Chat sessions: list by user, most recent first
create index idx_chat_sessions_user_id on public.chat_sessions(user_id, updated_at desc);

-- Thoughts: lookup by session
create index idx_thoughts_session_id on public.thoughts(session_id);

-- Thought decisions: lookup by thought
create index idx_thought_decisions_thought_id on public.thought_decisions(thought_id);

-- Thought decisions: reminder checker query
create index idx_thought_decisions_type on public.thought_decisions(decision_type);

-- Thought decisions: review filter (low confidence / pending)
create index idx_thought_decisions_review on public.thought_decisions(review_status, confidence);

-- Notifications: unread badge query
create index idx_notifications_user_unread on public.notifications(user_id, read_at) where read_at is null;

-- Notifications: list undismissed
create index idx_notifications_user_undismissed on public.notifications(user_id, dismissed_at) where dismissed_at is null;

-- Thought group members: reverse lookup (find groups for a thought)
create index idx_thought_group_members_group_id on public.thought_group_members(group_id);

-- ============================================================================
-- Similarity search function
-- ============================================================================

create or replace function public.match_thoughts(
  query_embedding extensions.vector(1536),
  match_threshold float default 0.5,
  match_count int default 10
)
returns table (
  id uuid,
  content text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    t.id,
    t.content,
    1 - (t.embedding <=> query_embedding) as similarity
  from public.thoughts t
  where t.embedding is not null
    and 1 - (t.embedding <=> query_embedding) > match_threshold
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.thoughts enable row level security;
alter table public.thought_decisions enable row level security;
alter table public.thought_groups enable row level security;
alter table public.thought_group_members enable row level security;
alter table public.notifications enable row level security;
alter table public.agent_state enable row level security;

-- Policy: any authenticated user gets full access (multi-user shared database)
create policy "Authenticated users have full access" on public.chat_sessions
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "Authenticated users have full access" on public.chat_messages
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "Authenticated users have full access" on public.thoughts
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "Authenticated users have full access" on public.thought_decisions
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "Authenticated users have full access" on public.thought_groups
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "Authenticated users have full access" on public.thought_group_members
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "Authenticated users have full access" on public.notifications
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "Authenticated users have full access" on public.agent_state
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ============================================================================
-- Realtime
-- ============================================================================

-- Enable Realtime for tables that need subscriptions
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.notifications;
