alter table public.collective_closure_days drop constraint if exists collective_closure_days_closure_type_check;
alter table public.collective_closure_days add constraint collective_closure_days_closure_type_check check (closure_type in ('public_holiday','collective_vacation','weekly_rest'));

alter table public.profiles add column if not exists weekly_hours numeric(5,2) not null default 40 check (weekly_hours >= 0 and weekly_hours <= 80);
update public.profiles set weekly_hours=40 where display_name in ('Alice','Inês Machado');
insert into public.profiles(display_name, role, active, weekly_hours) select 'Inês Machado','staff',true,40 where not exists (select 1 from public.profiles where lower(display_name)=lower('Inês Machado'));
insert into public.profiles(display_name, role, active, weekly_hours) select 'Inês Sequeira','staff',true,25 where not exists (select 1 from public.profiles where lower(display_name)=lower('Inês Sequeira'));
update public.profiles set weekly_hours=25 where display_name='Inês Sequeira';

alter table public.stock_items add column if not exists category text not null default 'Outros';

create table if not exists public.suppliers (
 id uuid primary key default gen_random_uuid(), name text not null unique, phone text,
 order_weekday smallint not null check(order_weekday between 1 and 7),
 delivery_weekday smallint not null check(delivery_weekday between 1 and 7),
 active boolean not null default true, created_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;
create policy suppliers_authenticated_read on public.suppliers for select to authenticated using (true);
create policy suppliers_manager_write on public.suppliers for all to authenticated using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());
grant select,insert,update,delete on public.suppliers to authenticated;
insert into public.suppliers(name,order_weekday,delivery_weekday) values ('Super Bock',3,4),('Pão',4,5),('Gelo',3,4),('Garrafeira',4,5),('Fruta',4,5),('Recheio',1,2),('Sumol Compal',2,3) on conflict(name) do update set order_weekday=excluded.order_weekday, delivery_weekday=excluded.delivery_weekday;

create table if not exists public.facility_cleaning_records (
 id uuid primary key default gen_random_uuid(), recorded_at timestamptz not null default now(),
 area_equipment text not null check(length(btrim(area_equipment)) between 1 and 180),
 responsible_id uuid not null references public.profiles(id), responsible_rubric text not null check(length(btrim(responsible_rubric)) between 1 and 30),
 observations text, product_used text, created_at timestamptz not null default now()
);
alter table public.facility_cleaning_records enable row level security;
create policy facility_cleaning_read on public.facility_cleaning_records for select to authenticated using (responsible_id = auth.uid() or public.is_manager_or_owner());
create policy facility_cleaning_insert_own on public.facility_cleaning_records for insert to authenticated with check (responsible_id = auth.uid());
grant select,insert on public.facility_cleaning_records to authenticated;

insert into public.collective_closure_days(closed_date,closure_type,note)
select d::date, case when extract(isodow from d) in (6,7) then 'weekly_rest' else 'collective_vacation' end,
case when extract(isodow from d) in (6,7) then 'Encerrado · folga semanal; não desconta férias' else 'Férias coletivas 2026' end
from generate_series(date '2026-01-02',date '2026-01-18',interval '1 day') d on conflict(closed_date) do nothing;
insert into public.collective_closure_days(closed_date,closure_type,note)
select d::date, case when extract(isodow from d) in (6,7) then 'weekly_rest' else 'collective_vacation' end,
case when extract(isodow from d) in (6,7) then 'Encerrado · folga semanal; não desconta férias' else 'Férias coletivas 2026' end
from generate_series(date '2026-06-29',date '2026-07-05',interval '1 day') d on conflict(closed_date) do nothing;
insert into public.collective_closure_days(closed_date,closure_type,note)
select d::date,'collective_vacation','Férias coletivas 2026' from generate_series(date '2026-08-03',date '2026-08-06',interval '1 day') d on conflict(closed_date) do nothing;
