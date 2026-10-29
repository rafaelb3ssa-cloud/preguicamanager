create table if not exists public.staff_onboarding_acknowledgements (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  revision text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (profile_id, revision)
);

alter table public.staff_onboarding_acknowledgements enable row level security;
revoke all on table public.staff_onboarding_acknowledgements from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_onboarding_acknowledgements to service_role;
