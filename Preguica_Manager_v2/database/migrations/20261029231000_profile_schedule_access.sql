alter table public.profiles
  add column if not exists schedule_access boolean not null default true;

comment on column public.profiles.schedule_access is
  'Allows a staff profile to view published schedules and the closure/vacation map. Managers retain full access.';
