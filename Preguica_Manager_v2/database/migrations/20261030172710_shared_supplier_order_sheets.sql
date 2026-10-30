create table if not exists public.supplier_order_sheets (
  supplier_key text primary key
    check (supplier_key in ('recheio','sumol','gelo','superbock','mapa','makro','pao','garrafeira','fruta','torrie')),
  lines jsonb not null default '[]'::jsonb
    check (jsonb_typeof(lines) = 'array'),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table public.supplier_order_sheets enable row level security;
revoke all on table public.supplier_order_sheets from anon, authenticated;
grant select, insert, update on table public.supplier_order_sheets to service_role;

comment on table public.supplier_order_sheets is
  'Shared current supplier order sheets. Access is mediated by the authenticated Preguica Edge Function; not directly exposed to clients.';
