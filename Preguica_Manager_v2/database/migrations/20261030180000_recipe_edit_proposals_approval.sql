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
