-- Expande o plano diário de higienização para oito tarefas, preservando os registos existentes.
insert into public.cleaning_tasks (name, frequency, active)
select items.name, 'daily', true
from (values
  ('WC e balneário'),
  ('Caixotes do lixo'),
  ('Máquina de lavar copos'),
  ('Infra'),
  ('Máquina do café')
) as items(name)
where not exists (
  select 1
  from public.cleaning_tasks existing
  where existing.frequency = 'daily'
    and lower(existing.name) = lower(items.name)
);
