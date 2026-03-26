-- Returns user messages that have no subsequent assistant response in the same session.
-- Used by the agent on startup to recover messages sent while it was down.
create or replace function public.get_unanswered_messages()
returns table (
  session_id uuid,
  user_id uuid,
  created_at timestamptz
)
language sql
stable
as $$
  select
    cm.session_id,
    cs.user_id,
    cm.created_at
  from public.chat_messages cm
  join public.chat_sessions cs on cs.id = cm.session_id
  where cm.role = 'user'
    and not exists (
      select 1
      from public.chat_messages resp
      where resp.session_id = cm.session_id
        and resp.role = 'assistant'
        and resp.created_at > cm.created_at
    )
  order by cm.created_at asc;
$$;
