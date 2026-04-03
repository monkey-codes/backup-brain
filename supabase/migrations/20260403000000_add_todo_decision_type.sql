-- Add 'todo' to the decision_type CHECK constraint on thought_decisions
alter table public.thought_decisions
  drop constraint thought_decisions_decision_type_check;

alter table public.thought_decisions
  add constraint thought_decisions_decision_type_check
    check (decision_type in ('classification', 'entity', 'reminder', 'tag', 'todo'));
