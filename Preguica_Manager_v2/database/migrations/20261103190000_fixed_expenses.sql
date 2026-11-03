create table if not exists public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  frequency text not null default 'monthly' check (frequency in ('monthly','annual')),
  amount numeric(12,2) check (amount is null or amount >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fixed_expenses enable row level security;
revoke all on public.fixed_expenses from public, anon, authenticated;
grant all on public.fixed_expenses to service_role;

insert into public.fixed_expenses (name, frequency, amount, sort_order)
values
  ('Salários líquidos', 'monthly', null, 0),
  ('Renda', 'monthly', null, 1),
  ('Água', 'monthly', null, 2),
  ('Luz', 'monthly', null, 3),
  ('Internet telefone', 'monthly', null, 4),
  ('Seguro acidentes trabalho', 'monthly', null, 5),
  ('Contablista', 'monthly', null, 6),
  ('Multibancos', 'monthly', null, 7),
  ('Segurança social', 'monthly', null, 8),
  ('Licença música e tv', 'monthly', null, 9),
  ('Licença POS', 'monthly', null, 10),
  ('Rentokil', 'monthly', null, 11),
  ('Carro', 'monthly', null, 12)
on conflict do nothing;
