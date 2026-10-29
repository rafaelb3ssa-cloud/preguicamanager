alter type public.attendance_kind add value if not exists 'vacation';

alter table public.suppliers
  alter column delivery_weekday drop not null;
alter table public.suppliers
  drop constraint if exists suppliers_delivery_weekday_check;
alter table public.suppliers
  add constraint suppliers_delivery_weekday_check
  check (delivery_weekday is null or delivery_weekday between 1 and 7);

insert into public.suppliers(name, order_weekday, delivery_weekday)
values ('Mapa dos Vinhos', 4, null)
on conflict (name) do update
set order_weekday = excluded.order_weekday,
    delivery_weekday = excluded.delivery_weekday;

alter table public.attendance_records
  add column if not exists original_occurred_at timestamptz;
