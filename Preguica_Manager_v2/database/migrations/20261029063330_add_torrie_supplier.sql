-- Torrie do café foi indicada como fornecedor; dias de encomenda e entrega por definir.
alter table public.suppliers
  alter column order_weekday drop not null;
alter table public.suppliers
  drop constraint if exists suppliers_order_weekday_check;
alter table public.suppliers
  add constraint suppliers_order_weekday_check
  check (order_weekday is null or order_weekday between 1 and 7);

insert into public.suppliers(name, order_weekday, delivery_weekday, active)
values ('Torrie do café', null, null, true)
on conflict (name) do update set active = true;
