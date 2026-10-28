-- A API de PIN valida a identidade na Edge Function e define updated_by.
-- O trigger mantém o autor correto mesmo sem um JWT Supabase por utilizador.
create or replace function public.audit_stock_quantity_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.quantity is distinct from old.quantity then
    insert into public.stock_movements(item_id, quantity_delta, reason, created_by)
    values (new.id, new.quantity - old.quantity, 'inventory_count', coalesce(auth.uid(), new.updated_by));
  end if;
  return new;
end;
$$;
