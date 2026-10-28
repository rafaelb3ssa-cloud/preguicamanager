# Preguiça Manager v2

## Estado e pré-visualização

A branch `codex/preguica-manager-v2-permissions` está ligada ao projeto Vercel `preguicamanager-web`. A versão aprovada foi publicada em produção a partir do commit `f9722bd7b9c1b4c28a411fffb838dbc2dc67d4e9`. O domínio `preguicamanager-web.vercel.app` serve `web/index.html` e recebeu HTTP 200 após a publicação. A produção permanece associada ao projeto Vercel existente.

A autenticação por PIN e as operações sensíveis passam pelo Edge Function `preguica-auth`, com sessões opacas e autorização no servidor. PINs são armazenados como hashes; a chave service-role fica apenas no ambiente da Edge Function. O ecrã de login apresenta apenas Gerência ou Colaborador. A escolha determina o perfil no servidor; o PIN nunca é validado só no browser. Para já, o login Colaborador usa o perfil Alice existente. Na aplicação, esse perfil vê apenas HACCP e os seus submenus, fichas técnicas em consulta e stock/compras. Só a Gerência vê os restantes módulos e pode editar fichas, configurar artigos ou gerir horários, férias e equipa. Os módulos de horários, assiduidade, higienização das instalações, fornecedores e stock usam operações persistentes na base de dados. Alertas automáticos continuam demonstrativos.

## Equipa e horários

Alice tem base semanal de 40 horas; Inês Machado, 40 horas; Inês Sequeira, 25 horas. Inês Machado e Inês Sequeira já estão na equipa, mas ainda não têm PIN próprio definido. O login Colaborador atual está associado ao perfil Alice até serem configuradas contas individuais.

A grelha semanal permite inserir um ou mais intervalos por dia, guardar rascunhos, publicar para consulta da equipa e criar uma revisão de um horário publicado. Horas reais de turnos ainda devem ser preenchidas pela Gerência; não foram inventados horários.

## Férias coletivas de 2026

O mapa mostra os dias encerrados, distinguindo férias coletivas, folga semanal e feriados. Foram registados os períodos 2–18 de janeiro, 29 de junho–5 de julho e 3–6 de agosto. Também permanecem os encerramentos de dezembro: dias 1, 8, 24, 25 e 31.

O total anual é 22 dias de férias: 11 em janeiro, 5 em junho/julho, 4 em agosto e 2 em dezembro. Oito sábados/domingos aparecem como folga e não descontam férias; os três feriados registados não descontam férias. A agenda pode ser descarregada em `.ics`.

## Stock e fornecedores

A lista sugerida calcula `max(0, mínimo configurado - quantidade atual)`. A colaboradora pode atualizar quantidades reais, mas não pode criar artigos nem mudar mínimos, preços ou fornecedores. Existem categorias para organizar o inventário.

Fornecedores e entregas registados: Recheio (segunda/terça), Sumol Compal (terça/quarta), Super Bock e gelo (quarta/quinta), pão, garrafeira e fruta (quinta/sexta). Telefones estão vazios porque não foram fornecidos.

O ficheiro Numbers recebido é um inventário de dezembro de 2025. Não foram importadas quantidades antigas como stock atual. Para importar nomes, categorias, unidades e custos sem quantidades, exportar o documento para Excel (`.xlsx`) ou CSV e enviá-lo.

## HACCP e higiene

O manual de referência é um modelo para café/bar com bebidas com e sem álcool e tostas; o manual oficial aprovado do estabelecimento continua a ser a referência. Não são inventados limites de temperatura. As grelhas mensais de temperaturas e higienização mantêm o histórico existente. Foi acrescentado o registo cronológico de higienização das instalações com dia/hora, área/equipamento, responsável, rubrica, produto e observações.

## Base de dados e alterações

O esquema original e os dados existentes foram preservados. A migração `20261028185524_team_schedule_suppliers_facility_log_and_leave_days.sql` acrescenta apenas a base semanal da equipa, categoria de stock, fornecedores, registos de higienização das instalações e os dias coletivos indicados.

A segurança deve continuar a ser revista antes de promover a produção. O Supabase Security Advisor ainda aponta funções `SECURITY DEFINER` preexistentes acessíveis a `authenticated`; as tabelas `app_sessions` e `pin_login_attempts` têm RLS sem políticas e são usadas pelo serviço privilegiado de autenticação. Estes avisos não foram alterados nesta branch.

## Vercel

Não há `vercel.json`, `package.json` nem `.vercel/project.json` no repositório. O projeto Vercel existente está associado ao repositório e os previews desta branch servem a aplicação corretamente; nenhuma configuração de build ou raiz foi alterada. A produção foi construída pela Vercel com a raiz `Preguica_Manager_v2/web`; o deploy ficou READY e o alias principal foi confirmado.
