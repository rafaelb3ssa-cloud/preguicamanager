-- Preguiça Manager v2 — esquema inicial PostgreSQL/Supabase
-- NÃO aplicar em produção sem revisão de segurança, RLS e testes.
create extension if not exists pgcrypto;

create type public.app_role as enum ('owner','manager','staff');
create type public.attendance_kind as enum ('clock_in','clock_out','late','absence','medical_leave','early_departure','other','vacation');
create type public.attendance_status as enum ('pending','validated','corrected','rejected');
create type public.request_status as enum ('pending','approved','rejected');
create type public.haccp_record_kind as enum ('temperature','cleaning','receiving','expiry_check','corrective_action');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.app_role not null default 'staff',
  active boolean not null default true,
  schedule_access boolean not null default true,
  attendance_access boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Outros',
  unit text not null,
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  minimum_quantity numeric(12,3) not null default 0 check (minimum_quantity >= 0),
  supplier_name text,
  unit_cost_ex_vat numeric(12,4),
  active boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items(id),
  quantity_delta numeric(12,3) not null,
  reason text not null,
  supplier_name text,
  lot_code text,
  expiry_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft','published','superseded')),
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  accumulated_hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(week_start, version)
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.weekly_schedules(id) on delete cascade,
  staff_id uuid not null references public.profiles(id),
  shift_date date not null,
  starts_at time not null,
  ends_at time not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  notes text
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id),
  leave_type text not null check (leave_type in ('holiday','personal','other')),
  start_date date not null,
  end_date date not null,
  note text,
  status public.request_status not null default 'pending',
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id),
  shift_id uuid references public.shifts(id),
  kind public.attendance_kind not null,
  occurred_at timestamptz not null,
  original_occurred_at timestamptz,
  note text,
  status public.attendance_status not null default 'pending',
  submitted_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  correction_reason text,
  original_record jsonb,
  created_at timestamptz not null default now()
);

create table public.haccp_records (
  id uuid primary key default gen_random_uuid(),
  kind public.haccp_record_kind not null,
  record_date date not null default current_date,
  recorded_at timestamptz not null default now(),
  staff_id uuid not null references public.profiles(id),
  equipment_name text,
  temperature_c numeric(5,2),
  checklist_key text,
  checklist_data jsonb not null default '{}'::jsonb,
  result text,
  corrective_action text,
  submitted_at timestamptz not null default now()
);

create table public.haccp_requirements (
  id uuid primary key default gen_random_uuid(),
  kind public.haccp_record_kind not null,
  requirement_key text not null,
  label text not null,
  required_by_time time,
  days_of_week integer[] not null default array[1,2,3,4,5,6,7],
  active boolean not null default true,
  unique(kind, requirement_key)
);

create table public.product_recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  sale_price_inc_vat numeric(12,2) not null check (sale_price_inc_vat >= 0),
  ingredient_cost_ex_vat numeric(12,4) not null default 0 check (ingredient_cost_ex_vat >= 0),
  ingredients jsonb not null default '[]'::jsonb,
  method text,
  history text,
  allergens text[] not null default '{}',
  active boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  table_name text not null,
  record_id uuid,
  reason text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index on public.attendance_records(staff_id, occurred_at desc);
create index on public.haccp_records(record_date, kind);
create index on public.stock_items(active, name);
create index on public.leave_requests(staff_id, start_date, end_date);
create index on public.shifts(staff_id, shift_date);

-- Nota crítica:
-- Ativar RLS em todas as tabelas e criar políticas testadas antes de qualquer utilização real.
-- A criação de contas e alteração de role devem ser feitas por função backend privilegiada,
-- nunca por campos enviados diretamente pelo cliente.
-- O alerta diário HACCP exige tarefa agendada no servidor, timezone Europe/Lisbon,
-- calendário de dias de funcionamento e regras de prazo por tipo de registo.
-- Para correções de assiduidade, gravar before/after e motivo em audit_log por trigger/função.

create table if not exists public.staff_onboarding_acknowledgements (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  revision text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (profile_id, revision)
);
alter table public.staff_onboarding_acknowledgements enable row level security;
revoke all on table public.staff_onboarding_acknowledgements from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_onboarding_acknowledgements to service_role;

create table if not exists public.staff_onboarding_modules (
  module_key text primary key check (module_key ~ '^module-0[1-9]$'),
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 12000),
  sort_order smallint not null unique,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.staff_onboarding_modules enable row level security;
revoke all on table public.staff_onboarding_modules from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_onboarding_modules to service_role;


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


create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  order_weekday smallint not null check (order_weekday between 1 and 7),
  delivery_weekday smallint not null check (delivery_weekday between 1 and 7),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

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
-- Draft changes to technical sheets remain unpublished until a manager approves them.
create table if not exists public.product_recipe_proposals (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references public.product_recipes(id),
  proposed_by uuid not null references public.profiles(id),
  name text not null,
  category text,
  ingredients text not null default '',
  method text,
  history text,
  allergens text[],
  sale_price_inc_vat numeric(12,2) check (sale_price_inc_vat is null or sale_price_inc_vat >= 0),
  ingredient_cost_ex_vat numeric(12,4) check (ingredient_cost_ex_vat is null or ingredient_cost_ex_vat >= 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists product_recipe_proposals_status_created_idx
  on public.product_recipe_proposals(status, created_at desc);
create unique index if not exists product_recipe_proposals_one_pending_per_recipe_idx
  on public.product_recipe_proposals(recipe_id) where status='pending' and recipe_id is not null;

alter table public.product_recipe_proposals enable row level security;
revoke all on table public.product_recipe_proposals from public, anon, authenticated;
grant select, insert, update, delete on table public.product_recipe_proposals to service_role;

create or replace function public.review_product_recipe_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_reviewer_id uuid,
  p_review_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  proposal public.product_recipe_proposals;
  published_recipe_id uuid;
begin
  if p_decision not in ('approved','rejected') then
    raise exception 'Decisão inválida.' using errcode='22023';
  end if;
  select * into proposal
  from public.product_recipe_proposals
  where id=p_proposal_id
  for update;
  if not found then
    raise exception 'Proposta não encontrada.' using errcode='P0002';
  end if;
  if proposal.status <> 'pending' then
    raise exception 'Esta proposta já foi revista.' using errcode='55000';
  end if;

  if p_decision='approved' then
    if proposal.recipe_id is null then
      if proposal.sale_price_inc_vat is null or proposal.ingredient_cost_ex_vat is null then
        raise exception 'Uma nova ficha precisa de preço e custo definidos pela Gerência.' using errcode='22023';
      end if;
      insert into public.product_recipes(
        name,category,sale_price_inc_vat,ingredient_cost_ex_vat,ingredients,method,history,allergens,active,updated_by,updated_at
      ) values (
        proposal.name,proposal.category,proposal.sale_price_inc_vat,proposal.ingredient_cost_ex_vat,
        jsonb_build_array(proposal.ingredients),proposal.method,proposal.history,coalesce(proposal.allergens,'{}'),true,p_reviewer_id,now()
      ) returning id into published_recipe_id;
    else
      update public.product_recipes set
        name=proposal.name,
        category=proposal.category,
        ingredients=jsonb_build_array(proposal.ingredients),
        method=proposal.method,
        history=proposal.history,
        allergens=coalesce(proposal.allergens,allergens),
        sale_price_inc_vat=coalesce(proposal.sale_price_inc_vat,sale_price_inc_vat),
        ingredient_cost_ex_vat=coalesce(proposal.ingredient_cost_ex_vat,ingredient_cost_ex_vat),
        active=true,
        updated_by=p_reviewer_id,
        updated_at=now()
      where id=proposal.recipe_id
      returning id into published_recipe_id;
      if not found then
        raise exception 'A ficha original já não existe.' using errcode='P0002';
      end if;
    end if;
  else
    published_recipe_id=proposal.recipe_id;
  end if;

  update public.product_recipe_proposals set
    status=p_decision,
    review_note=nullif(left(coalesce(p_review_note,''),1000),''),
    reviewed_by=p_reviewer_id,
    reviewed_at=now()
  where id=p_proposal_id;
  return jsonb_build_object('ok',true,'status',p_decision,'recipe_id',published_recipe_id);
end;
$function$;

revoke all on function public.review_product_recipe_proposal(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.review_product_recipe_proposal(uuid,text,uuid,text) to service_role;
