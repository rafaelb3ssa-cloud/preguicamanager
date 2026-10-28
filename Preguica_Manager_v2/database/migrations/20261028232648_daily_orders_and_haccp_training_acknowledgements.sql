create table if not exists public.daily_order_items (
 order_date date not null,
 stock_item_id uuid not null references public.stock_items(id) on delete cascade,
 quantity numeric(12,3) not null default 0 check (quantity >= 0),
 is_selected boolean not null default false,
 ordered_by uuid references public.profiles(id),
 updated_at timestamptz not null default now(),
 primary key (order_date, stock_item_id)
);
alter table public.daily_order_items enable row level security;
revoke all on public.daily_order_items from public, anon, authenticated;
grant all on public.daily_order_items to service_role;

create table if not exists public.haccp_training_acknowledgements (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id) on delete restrict,
 manual_revision text not null,
 acknowledged_at timestamptz not null default now(),
 unique (profile_id, manual_revision)
);
alter table public.haccp_training_acknowledgements enable row level security;
revoke all on public.haccp_training_acknowledgements from public, anon, authenticated;
grant all on public.haccp_training_acknowledgements to service_role;
create index if not exists haccp_training_ack_profile_idx on public.haccp_training_acknowledgements(profile_id, acknowledged_at desc);
