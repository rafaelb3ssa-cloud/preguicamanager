-- Endurece as vistas de férias para aplicarem RLS do utilizador que consulta.
-- A colaboradora só vê nomes, férias aprovadas/registadas e saldos; nunca notas.
begin;

alter view public.staff_leave_calendar set (security_invoker = true);
alter view public.staff_leave_balances set (security_invoker = true);

-- Perfis: expõe apenas id/nome à aplicação e permite o diretório ativo usado
-- no mapa de férias. role e restantes colunas continuam fora do acesso cliente.
revoke select on public.profiles from authenticated;
grant select (id, display_name) on public.profiles to authenticated;

drop policy if exists profiles_directory_read on public.profiles;
create policy profiles_directory_read on public.profiles for select to authenticated
using (active and public.current_app_role() in ('owner', 'manager', 'staff'));

-- Férias: limita a leitura direta a colunas de calendário, e staff só consulta
-- marcações do tipo férias. A escrita continua reservada à gerência.
revoke select on public.leave_requests from authenticated;
grant select (id, staff_id, leave_type, start_date, end_date, status, cancelled_at)
  on public.leave_requests to authenticated;

drop policy if exists leave_staff_calendar_read on public.leave_requests;
create policy leave_staff_calendar_read on public.leave_requests for select to authenticated
using (public.current_app_role() = 'staff' and leave_type = 'holiday');

-- A gerência continua a consultar notas e campos de decisão através deste RPC
-- protegido. A função não está acessível a anon e verifica o perfil em cada uso.
create or replace function public.manager_leave_requests()
returns setof public.leave_requests
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_manager_or_owner() then
    raise exception 'Apenas gerência pode consultar detalhes de férias' using errcode = '42501';
  end if;
  return query
    select l.* from public.leave_requests l
    order by l.start_date desc, l.created_at desc;
end;
$$;
revoke all on function public.manager_leave_requests() from public, anon;
grant execute on function public.manager_leave_requests() to authenticated;

-- Saldos: staff pode ler apenas os campos necessários, sem metadados de gestão.
revoke select on public.leave_balances from authenticated;
grant select (staff_id, reference_year, entitled_days, used_days)
  on public.leave_balances to authenticated;
drop policy if exists leave_balances_read_manager on public.leave_balances;
create policy leave_balances_read_manager on public.leave_balances for select to authenticated
using (public.current_app_role() in ('owner', 'manager', 'staff'));

commit;
