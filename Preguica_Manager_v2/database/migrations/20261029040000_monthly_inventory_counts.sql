alter table public.stock_items add column if not exists category text not null default 'Outros';

create table public.monthly_inventory_counts (
  id uuid primary key default gen_random_uuid(),
  inventory_month date not null unique check (extract(day from inventory_month)=1),
  items jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.monthly_inventory_counts enable row level security;
revoke all on public.monthly_inventory_counts from public, anon, authenticated;
grant all on public.monthly_inventory_counts to service_role;
