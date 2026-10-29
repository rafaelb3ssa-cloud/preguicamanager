alter table public.profiles add column if not exists activity_exempt boolean not null default false;
update public.profiles set activity_exempt=true where lower(btrim(display_name))='alice' and role='staff';

create table if not exists public.activity_requirement_settings (
 singleton boolean primary key default true check (singleton),
 start_date date not null,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now()
);
insert into public.activity_requirement_settings(singleton,start_date)
values (true,date '2026-10-29') on conflict(singleton) do nothing;
alter table public.activity_requirement_settings enable row level security;
revoke all on public.activity_requirement_settings from public, anon, authenticated;
grant all on public.activity_requirement_settings to service_role;

create table if not exists public.staff_activity_logs (
 id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references public.profiles(id) on delete restrict,
 activity_date date not null,
 activity_summary text,
 handover_notes text,
 status text not null default 'draft' check(status in ('draft','submitted')),
 submitted_at timestamptz,
 submitted_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(staff_id,activity_date),
 check ((status='draft' and submitted_at is null) or (status='submitted' and submitted_at is not null))
);
create index if not exists staff_activity_logs_date_idx on public.staff_activity_logs(activity_date,staff_id);
alter table public.staff_activity_logs enable row level security;
revoke all on public.staff_activity_logs from public, anon, authenticated;
grant all on public.staff_activity_logs to service_role;
