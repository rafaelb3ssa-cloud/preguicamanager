-- Private invoice archive for management and the Rafael profile.
-- API access is server-only; Storage objects use signed upload/download URLs.
create table if not exists public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  invoice_date date not null,
  supplier_name text not null,
  invoice_number text,
  description text,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  storage_path text not null unique,
  original_filename text not null,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf')),
  file_size bigint not null check (file_size > 0 and file_size <= 20971520),
  uploaded_by uuid not null references public.profiles(id),
  upload_status text not null default 'pending' check (upload_status in ('pending','available')),
  created_at timestamptz not null default now()
);
create index if not exists invoice_documents_month_date_idx
  on public.invoice_documents (invoice_date desc, created_at desc);
alter table public.invoice_documents enable row level security;
revoke all on table public.invoice_documents from anon, authenticated;
grant all on table public.invoice_documents to service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cafe-invoices','cafe-invoices',false,20971520,array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
