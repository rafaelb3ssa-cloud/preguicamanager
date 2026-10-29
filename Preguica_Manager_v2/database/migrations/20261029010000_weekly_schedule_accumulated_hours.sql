alter table public.weekly_schedules add column if not exists accumulated_hours jsonb not null default '{}'::jsonb;
