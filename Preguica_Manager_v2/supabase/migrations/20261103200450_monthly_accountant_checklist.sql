create table if not exists public.monthly_accountant_checks (
  month_start date not null check (extract(day from month_start) = 1),
  task_key text not null check (task_key in (
    'saft', 'bank_statements_and_invoices', 'invoices', 'vat_map',
    'sold_items', 'daily_billing_history', 'email_replies'
  )),
  checked_by uuid not null references public.profiles(id),
  checked_at timestamptz not null default now(),
  primary key (month_start, task_key)
);
alter table public.monthly_accountant_checks enable row level security;
revoke all on table public.monthly_accountant_checks from anon, authenticated;
comment on table public.monthly_accountant_checks is 'Monthly accountant submission checklist; accessed only through the authenticated Preguica Edge Function.';