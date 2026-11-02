-- Shared one-tap daily operational checks, attributed to the profile that confirms each item.
create table if not exists public.daily_operation_checks (
  id uuid primary key default gen_random_uuid(),
  check_date date not null,
  task_key text not null check (task_key in ('bar_fridge_restock','preguicinhas_mise_en_place','second_floor_clean')),
  checked_by uuid not null references public.profiles(id),
  checked_at timestamptz not null default now(),
  unique (check_date, task_key)
);
create index if not exists daily_operation_checks_date_idx
  on public.daily_operation_checks (check_date desc);
alter table public.daily_operation_checks enable row level security;
revoke all on table public.daily_operation_checks from anon, authenticated;
grant all on table public.daily_operation_checks to service_role;
