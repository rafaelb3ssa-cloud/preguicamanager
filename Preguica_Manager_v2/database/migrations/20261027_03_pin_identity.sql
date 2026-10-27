begin;

-- Identidades da aplicação por PIN. Perfis/tabelas existentes são mantidos;
-- os IDs deixam de depender de contas de email do Supabase Auth.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles
  add column if not exists pin_hash text,
  add column if not exists pin_changed_at timestamptz not null default now();

create table if not exists public.app_sessions (
  token_hash text primary key,
  profile_id uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pin_login_attempts (
  attempt_key text primary key,
  failures integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.app_sessions enable row level security;
alter table public.pin_login_attempts enable row level security;
revoke all on public.app_sessions, public.pin_login_attempts from anon, authenticated;
revoke all on public.profiles from anon, authenticated;

-- Only the Edge Function's service role can compare a PIN hash.
create or replace function public.verify_app_pin(p_profile_id uuid, p_pin text)
returns boolean language sql security definer set search_path = '' as $$
  select coalesce((select extensions.crypt(p_pin, p.pin_hash) = p.pin_hash
    from public.profiles p where p.id = p_profile_id and p.active and p.pin_hash is not null), false)
$$;
revoke all on function public.verify_app_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_app_pin(uuid, text) to service_role;

create or replace function public.create_pin_profile(p_name text, p_role public.app_role, p_pin text)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles;
begin
  if nullif(trim(p_name), '') is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'Dados de utilizador inválidos' using errcode = '22023';
  end if;
  insert into public.profiles(display_name, role, pin_hash)
  values (trim(p_name), p_role, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)))
  returning * into v_profile;
  return v_profile;
end
$$;
revoke all on function public.create_pin_profile(text, public.app_role, text) from public, anon, authenticated;
grant execute on function public.create_pin_profile(text, public.app_role, text) to service_role;

create or replace function public.change_profile_pin(p_profile_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN inválido' using errcode = '22023'; end if;
  update public.profiles set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), pin_changed_at = now()
  where id = p_profile_id and active;
  if not found then raise exception 'Utilizador inexistente'; end if;
end
$$;
revoke all on function public.change_profile_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.change_profile_pin(uuid, text) to service_role;

create or replace function public.check_pin_login_lock(p_attempt_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_locked timestamptz;
begin
  select locked_until into v_locked from public.pin_login_attempts where attempt_key = p_attempt_key;
  return v_locked is not null and v_locked > now();
end
$$;
revoke all on function public.check_pin_login_lock(text) from public, anon, authenticated;
grant execute on function public.check_pin_login_lock(text) to service_role;

create or replace function public.record_pin_login_attempt(p_attempt_key text, p_success boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_success then
    delete from public.pin_login_attempts where attempt_key = p_attempt_key;
    return;
  end if;
  insert into public.pin_login_attempts(attempt_key, failures, window_started_at, locked_until)
  values (p_attempt_key, 1, now(), null)
  on conflict (attempt_key) do update set
    failures = case when public.pin_login_attempts.window_started_at < now() - interval '15 minutes'
      then 1 else public.pin_login_attempts.failures + 1 end,
    window_started_at = case when public.pin_login_attempts.window_started_at < now() - interval '15 minutes'
      then now() else public.pin_login_attempts.window_started_at end,
    locked_until = case when public.pin_login_attempts.failures + 1 >= 6
      then now() + interval '15 minutes' else public.pin_login_attempts.locked_until end;
end
$$;
revoke all on function public.record_pin_login_attempt(text, boolean) from public, anon, authenticated;
grant execute on function public.record_pin_login_attempt(text, boolean) to service_role;

-- Hashes generated with pgcrypto; the PIN values are not stored in this migration.
insert into public.profiles (id, display_name, role, active, pin_hash) values
 ('a810d2be-0c29-4aa8-a1d5-b80003db1a01', 'Gerência', 'owner', true,
  '$2a$12$gfiAKf0p80J9I5fM8QMd3eaYgnVDtlw0paKWGRgrrhmNVU3gKXfSS'),
 ('a810d2be-0c29-4aa8-a1d5-b80003db1a02', 'Alice', 'staff', true,
  '$2a$12$INIA2l9qtaQsmjfIRi5s6.94.f26efW7MJIgKfAIH1OMrhvLt/QSu')
on conflict (id) do nothing;

commit;
