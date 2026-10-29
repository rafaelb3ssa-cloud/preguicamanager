-- Guarda historia curta dos cocktails e a confirmacao diaria das encomendas por fornecedor.
alter table public.product_recipes add column if not exists history text;

create table if not exists public.supplier_order_checks (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  order_date date not null,
  completed_by uuid not null references public.profiles(id),
  completed_at timestamptz not null default now(),
  primary key (supplier_id, order_date)
);
alter table public.supplier_order_checks enable row level security;
revoke all on table public.supplier_order_checks from public, anon, authenticated;
grant select, insert, update, delete on table public.supplier_order_checks to service_role;
