-- Aditiva e não destrutiva: preserva todas as tabelas e linhas existentes.
-- Aplicar primeiro numa cópia/staging e validar com os testes documentados.
begin;

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.active = true
$$;

create or replace function public.is_manager_or_owner()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select coalesce(public.current_app_role() in ('owner', 'manager'), false) $$;

revoke all on function public.current_app_role() from public, anon;
revoke all on function public.is_manager_or_owner() from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_manager_or_owner() to authenticated;

create table if not exists public.cleaning_tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (frequency, name)
);

create table if not exists public.cleaning_records (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.cleaning_tasks(id),
  task_name text not null,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  completed_at timestamptz not null default now(),
  completed_by uuid not null references public.profiles(id),
  observations text,
  product_used text,
  created_at timestamptz not null default now()
);

-- Saldos ficam vazios até a gerência inserir valores confirmados.
create table if not exists public.leave_balances (
  staff_id uuid not null references public.profiles(id),
  reference_year integer not null,
  entitled_days numeric(6,2) not null check (entitled_days >= 0),
  used_days numeric(6,2) not null default 0 check (used_days >= 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (staff_id, reference_year)
);

alter table public.leave_requests
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id);

-- Vistas para staff expõem apenas o calendário de férias e os saldos, sem notas
-- pessoais ou outros tipos de ausência presentes em leave_requests.
create or replace view public.staff_leave_calendar as
select l.id, l.staff_id, p.display_name, l.start_date, l.end_date, l.status, l.cancelled_at
from public.leave_requests l
join public.profiles p on p.id = l.staff_id
where l.leave_type = 'holiday'
  and public.current_app_role() in ('owner', 'manager', 'staff');

create or replace view public.staff_leave_balances as
select b.staff_id, p.display_name, b.reference_year, b.entitled_days, b.used_days,
       b.entitled_days - b.used_days as remaining_days
from public.leave_balances b
join public.profiles p on p.id = b.staff_id
where public.current_app_role() in ('owner', 'manager', 'staff');

grant select on public.staff_leave_calendar, public.staff_leave_balances to authenticated;

create index if not exists cleaning_records_completed_at_idx
  on public.cleaning_records (completed_at desc);
create index if not exists cleaning_records_task_day_idx
  on public.cleaning_records (task_id, completed_at desc);

insert into public.cleaning_tasks (name, frequency) values
  ('Bancadas e superfícies', 'daily'),
  ('Chão', 'daily'),
  ('Instrumentos e utensílios', 'daily'),
  ('Vidros', 'weekly'),
  ('Pó', 'weekly'),
  ('Teias de aranha', 'weekly'),
  ('Frigoríficos', 'weekly'),
  ('Paredes', 'monthly'),
  ('Teto', 'monthly'),
  ('Candeeiros', 'monthly'),
  ('Congelador', 'monthly'),
  ('Zona do armazém', 'monthly')
on conflict (frequency, name) do nothing;

-- Staff altera exclusivamente a quantidade real. Configuração de artigos usa RPC.
create or replace function public.update_stock_quantity(p_item_id uuid, p_quantity numeric)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.current_app_role() not in ('owner', 'manager', 'staff'), true) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Quantidade inválida' using errcode = '22023';
  end if;
  update public.stock_items set quantity = p_quantity, updated_by = auth.uid(), updated_at = now()
  where id = p_item_id and active = true;
  if not found then raise exception 'Artigo inexistente ou inativo'; end if;
end;
$$;

create or replace function public.configure_stock_item(
  p_item_id uuid,
  p_name text,
  p_unit text,
  p_quantity numeric,
  p_minimum_quantity numeric,
  p_supplier_name text,
  p_unit_cost_ex_vat numeric
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.is_manager_or_owner() then
    raise exception 'Apenas gerência pode configurar artigos' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_unit), '') is null
     or p_quantity < 0 or p_minimum_quantity < 0 or p_unit_cost_ex_vat < 0 then
    raise exception 'Dados de artigo inválidos' using errcode = '22023';
  end if;
  if p_item_id is null then
    insert into public.stock_items(name, unit, quantity, minimum_quantity, supplier_name, unit_cost_ex_vat, updated_by)
    values (trim(p_name), trim(p_unit), p_quantity, p_minimum_quantity, p_supplier_name, p_unit_cost_ex_vat, auth.uid())
    returning id into v_id;
  else
    update public.stock_items set name = trim(p_name), unit = trim(p_unit), quantity = p_quantity,
      minimum_quantity = p_minimum_quantity, supplier_name = p_supplier_name,
      unit_cost_ex_vat = p_unit_cost_ex_vat, updated_by = auth.uid(), updated_at = now()
    where id = p_item_id returning id into v_id;
    if not found then raise exception 'Artigo inexistente'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.add_monthly_cleaning_task(p_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.is_manager_or_owner() then
    raise exception 'Apenas gerência pode adicionar tarefas' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null then raise exception 'Nome obrigatório' using errcode = '22023'; end if;
  insert into public.cleaning_tasks(name, frequency, created_by)
  values (trim(p_name), 'monthly', auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.update_stock_quantity(uuid, numeric) from public, anon;
revoke all on function public.configure_stock_item(uuid, text, text, numeric, numeric, text, numeric) from public, anon;
revoke all on function public.add_monthly_cleaning_task(text) from public, anon;
grant execute on function public.update_stock_quantity(uuid, numeric) to authenticated;
grant execute on function public.configure_stock_item(uuid, text, text, numeric, numeric, text, numeric) to authenticated;
grant execute on function public.add_monthly_cleaning_task(text) to authenticated;

-- Regista cada contagem de inventário como movimento imutável.
create or replace function public.audit_stock_quantity_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.quantity is distinct from old.quantity then
    insert into public.stock_movements(item_id, quantity_delta, reason, created_by)
    values (new.id, new.quantity - old.quantity, 'inventory_count', auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists stock_quantity_movement on public.stock_items;
create trigger stock_quantity_movement after update of quantity on public.stock_items
for each row execute function public.audit_stock_quantity_change();

create or replace function public.audit_leave_request_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log(actor_id, action, table_name, record_id, before_data, after_data)
  values (auth.uid(), lower(tg_op), 'leave_requests', coalesce(new.id, old.id),
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new));
  return new;
end;
$$;
drop trigger if exists leave_request_audit on public.leave_requests;
create trigger leave_request_audit after insert or update on public.leave_requests
for each row execute function public.audit_leave_request_change();

-- Ativa RLS em todas as tabelas do esquema original e nas novas tabelas.
alter table public.profiles enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.weekly_schedules enable row level security;
alter table public.shifts enable row level security;
alter table public.leave_requests enable row level security;
alter table public.attendance_records enable row level security;
alter table public.haccp_records enable row level security;
alter table public.haccp_requirements enable row level security;
alter table public.product_recipes enable row level security;
alter table public.audit_log enable row level security;
alter table public.cleaning_tasks enable row level security;
alter table public.cleaning_records enable row level security;
alter table public.leave_balances enable row level security;

-- Remove permissões implícitas antes de conceder o mínimo necessário.
revoke all on public.profiles, public.stock_items, public.stock_movements,
  public.weekly_schedules, public.shifts, public.leave_requests,
  public.attendance_records, public.haccp_records, public.haccp_requirements,
  public.product_recipes, public.audit_log, public.cleaning_tasks,
  public.cleaning_records, public.leave_balances from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.stock_items, public.stock_movements to authenticated;
grant select on public.weekly_schedules, public.shifts to authenticated;
grant select, insert, update, delete on public.leave_requests to authenticated;
revoke delete on public.leave_requests from authenticated;
grant select, insert, update, delete on public.leave_balances to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;
grant select, insert on public.haccp_records to authenticated;
grant select on public.haccp_requirements to authenticated;
grant select, insert, update, delete on public.product_recipes to authenticated;
grant select on public.audit_log to authenticated;
grant select, update on public.cleaning_tasks to authenticated;
grant select, insert on public.cleaning_records to authenticated;

drop policy if exists profiles_read_self_or_manager on public.profiles;
create policy profiles_read_self_or_manager on public.profiles for select to authenticated
using (public.current_app_role() in ('owner', 'manager', 'staff')
  and (id = auth.uid() or public.is_manager_or_owner()));

drop policy if exists stock_items_read on public.stock_items;
create policy stock_items_read on public.stock_items for select to authenticated
using (public.current_app_role() in ('owner', 'manager', 'staff') and (active or public.is_manager_or_owner()));
drop policy if exists stock_items_update_quantity on public.stock_items;
create policy stock_items_update_quantity on public.stock_items for update to authenticated
using (active and public.current_app_role() in ('owner', 'manager', 'staff'))
with check (active and public.current_app_role() in ('owner', 'manager', 'staff'));
drop policy if exists stock_movements_read on public.stock_movements;
create policy stock_movements_read on public.stock_movements for select to authenticated
using (public.current_app_role() in ('owner', 'manager', 'staff'));

drop policy if exists schedules_manager_all on public.weekly_schedules;
create policy schedules_manager_all on public.weekly_schedules for all to authenticated
using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());
drop policy if exists shifts_manager_all on public.shifts;
create policy shifts_manager_all on public.shifts for all to authenticated
using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());
drop policy if exists leave_read_calendar on public.leave_requests;
create policy leave_read_calendar on public.leave_requests for select to authenticated
using (public.is_manager_or_owner());
drop policy if exists leave_manager_insert on public.leave_requests;
create policy leave_manager_insert on public.leave_requests for insert to authenticated
with check (public.is_manager_or_owner());
drop policy if exists leave_manager_update on public.leave_requests;
create policy leave_manager_update on public.leave_requests for update to authenticated
using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());

drop policy if exists leave_balances_read_manager on public.leave_balances;
create policy leave_balances_read_manager on public.leave_balances for select to authenticated
using (public.is_manager_or_owner());
drop policy if exists leave_balances_manager_write on public.leave_balances;
create policy leave_balances_manager_write on public.leave_balances for all to authenticated
using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());

drop policy if exists attendance_manager_all on public.attendance_records;
create policy attendance_manager_all on public.attendance_records for all to authenticated
using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());

drop policy if exists haccp_read_all on public.haccp_records;
create policy haccp_read_all on public.haccp_records for select to authenticated
using (public.current_app_role() in ('owner', 'manager', 'staff'));
drop policy if exists haccp_insert_self on public.haccp_records;
create policy haccp_insert_self on public.haccp_records for insert to authenticated
with check (public.current_app_role() in ('owner', 'manager')
  or (public.current_app_role() = 'staff' and staff_id = auth.uid()));
drop policy if exists haccp_requirements_read on public.haccp_requirements;
create policy haccp_requirements_read on public.haccp_requirements for select to authenticated
using (public.current_app_role() in ('owner', 'manager', 'staff') and (active or public.is_manager_or_owner()));

drop policy if exists recipes_manager_all on public.product_recipes;
create policy recipes_manager_all on public.product_recipes for all to authenticated
using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());
drop policy if exists audit_manager_read on public.audit_log;
create policy audit_manager_read on public.audit_log for select to authenticated
using (public.is_manager_or_owner());

drop policy if exists cleaning_tasks_read on public.cleaning_tasks;
create policy cleaning_tasks_read on public.cleaning_tasks for select to authenticated
using (public.current_app_role() in ('owner', 'manager', 'staff') and (active or public.is_manager_or_owner()));
drop policy if exists cleaning_tasks_manager_update on public.cleaning_tasks;
create policy cleaning_tasks_manager_update on public.cleaning_tasks for update to authenticated
using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());
drop policy if exists cleaning_records_read on public.cleaning_records;
create policy cleaning_records_read on public.cleaning_records for select to authenticated
using (public.is_manager_or_owner() or (public.current_app_role() = 'staff' and completed_by = auth.uid()));
drop policy if exists cleaning_records_insert_self on public.cleaning_records;
create policy cleaning_records_insert_self on public.cleaning_records for insert to authenticated
with check (public.current_app_role() in ('owner', 'manager', 'staff')
  and completed_by = auth.uid() and exists (
  select 1 from public.cleaning_tasks t where t.id = task_id and t.active
));

commit;
