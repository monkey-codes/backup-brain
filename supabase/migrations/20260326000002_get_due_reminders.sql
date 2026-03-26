-- Returns reminder decisions that are due and don't already have a notification.
-- Used by the agent's reminder checker cron job (every 1 minute).
create or replace function public.get_due_reminders()
returns table (
  decision_id uuid,
  thought_id uuid,
  thought_content text,
  user_id uuid,
  description text,
  due_at timestamptz
)
language sql
security definer
as $$
  select
    td.id as decision_id,
    t.id as thought_id,
    t.content as thought_content,
    t.created_by as user_id,
    coalesce(
      td.corrected_value->>'description',
      td.value->>'description'
    ) as description,
    coalesce(
      (td.corrected_value->>'due_at')::timestamptz,
      (td.value->>'due_at')::timestamptz
    ) as due_at
  from thought_decisions td
  join thoughts t on t.id = td.thought_id
  left join notifications n on n.decision_id = td.id
  where td.decision_type = 'reminder'
    and n.id is null
    and coalesce(
      (td.corrected_value->>'due_at')::timestamptz,
      (td.value->>'due_at')::timestamptz
    ) <= now();
$$;
