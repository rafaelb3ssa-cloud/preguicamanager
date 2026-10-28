create table public.collective_closure_days (
  closed_date date primary key,
  closure_type text not null check (closure_type in ('public_holiday', 'collective_vacation')),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.collective_closure_days enable row level security;
grant select, insert, update, delete on public.collective_closure_days to authenticated;

create policy collective_closure_days_read
  on public.collective_closure_days for select to authenticated
  using (public.current_app_role() in ('owner', 'manager', 'staff'));

create policy collective_closure_days_manager_write
  on public.collective_closure_days for all to authenticated
  using (public.is_manager_or_owner())
  with check (public.is_manager_or_owner());

insert into public.collective_closure_days (closed_date, closure_type, note)
values
  ('2026-12-01', 'public_holiday', 'Encerrado — feriado nacional'),
  ('2026-12-08', 'public_holiday', 'Encerrado — feriado nacional'),
  ('2026-12-24', 'collective_vacation', 'Encerrado — férias coletivas'),
  ('2026-12-25', 'public_holiday', 'Encerrado — feriado nacional'),
  ('2026-12-31', 'collective_vacation', 'Encerrado — férias coletivas')
on conflict (closed_date) do nothing;
