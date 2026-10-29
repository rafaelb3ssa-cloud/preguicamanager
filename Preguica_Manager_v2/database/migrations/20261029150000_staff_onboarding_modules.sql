create table if not exists public.staff_onboarding_modules (
  module_key text primary key check (module_key ~ '^module-0[1-9]$'),
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 12000),
  sort_order smallint not null unique,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.staff_onboarding_modules enable row level security;
revoke all on table public.staff_onboarding_modules from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_onboarding_modules to service_role;
