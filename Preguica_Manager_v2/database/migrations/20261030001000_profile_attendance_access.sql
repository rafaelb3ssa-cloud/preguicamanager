alter table public.profiles
  add column if not exists attendance_access boolean not null default true;

comment on column public.profiles.attendance_access is
  'Allows a staff profile to view and submit their attendance register.';
