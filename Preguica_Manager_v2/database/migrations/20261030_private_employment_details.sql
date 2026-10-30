create table if not exists public.staff_employment_details (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  start_date date not null
);
alter table public.staff_employment_details enable row level security;
revoke all on table public.staff_employment_details from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_employment_details to service_role;

create table if not exists public.company_private_settings (
  setting_key text primary key,
  provider_name text not null,
  policy_number text not null,
  updated_at timestamptz not null default now()
);
alter table public.company_private_settings enable row level security;
revoke all on table public.company_private_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.company_private_settings to service_role;
