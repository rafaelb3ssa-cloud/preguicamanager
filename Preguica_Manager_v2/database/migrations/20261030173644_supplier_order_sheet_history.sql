create table if not exists public.supplier_order_sheet_history (
  id uuid primary key default gen_random_uuid(),
  changed_by uuid not null references public.profiles(id) on delete restrict,
  supplier_keys text[] not null default '{}',
  line_count integer not null default 0 check (line_count >= 0),
  saved_at timestamptz not null default now()
);

create index if not exists supplier_order_sheet_history_saved_at_idx
  on public.supplier_order_sheet_history (saved_at desc);

alter table public.supplier_order_sheet_history enable row level security;
revoke all on table public.supplier_order_sheet_history from anon, authenticated;
grant select, insert on table public.supplier_order_sheet_history to service_role;

comment on table public.supplier_order_sheet_history is
  'Audit trail for shared supplier order sheet saves. Read/write via authenticated Edge Function only.';
