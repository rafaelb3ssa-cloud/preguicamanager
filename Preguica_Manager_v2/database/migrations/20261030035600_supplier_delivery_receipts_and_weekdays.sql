-- Guarda cada verificação de receção como evento; os registos anteriores não são substituídos.
create table if not exists public.supplier_delivery_checks (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  delivery_date date not null,
  status text not null check (status in ('received_ok','not_arrived','condition_issue')),
  observations text not null default '',
  checked_by uuid not null references public.profiles(id),
  checked_at timestamptz not null default now()
);
create index if not exists supplier_delivery_checks_date_idx
  on public.supplier_delivery_checks(delivery_date, supplier_id, checked_at desc);
alter table public.supplier_delivery_checks enable row level security;
revoke all on table public.supplier_delivery_checks from public, anon, authenticated;
grant select, insert on table public.supplier_delivery_checks to service_role;

-- Confirmação de encomendas e entregas no dia seguinte.
update public.suppliers set order_weekday=1, delivery_weekday=2, updated_at=now() where name='Recheio';
update public.suppliers set order_weekday=2, delivery_weekday=3, updated_at=now() where name='Sumol Compal';
update public.suppliers set order_weekday=3, delivery_weekday=4, updated_at=now() where name in ('Gelo','Super Bock');
update public.suppliers set order_weekday=4, delivery_weekday=5, updated_at=now() where name='Mapa dos Vinhos';
insert into public.suppliers(name,order_weekday,delivery_weekday,active)
values ('Makro',4,5,true)
on conflict(name) do update set order_weekday=excluded.order_weekday,delivery_weekday=excluded.delivery_weekday,active=true,updated_at=now();
