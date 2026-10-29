# Segurança e publicação — Preguiça Manager v2

## Modelo proposto

| Área | Owner / gerência | Colaboradora |
| --- | --- | --- |
| Painel e alertas | Acesso | Sem dados laborais/administrativos |
| Stock e compras | Gerir artigos, mínimos, custos e fornecedores | Consultar; atualizar apenas quantidade real |
| Horários | Gerir | Sem acesso |
| Férias | Criar, editar e cancelar; definir saldos | Consultar calendário e saldos confirmados; sem escrita |
| Assiduidade | Gerir e validar | Sem acesso |
| HACCP e higiene | Consultar e registar | Consultar e registar temperaturas, checklists e higienização |
| Fichas técnicas | Gerir | Sem acesso |
| Equipa | Gerir funções e contas | Sem acesso |

O perfil ativo `owner` é a conta proprietária. A migração de PIN mantém as tabelas e os registos existentes, remove apenas a dependência de `profiles.id` em `auth.users`, e cria os perfis Gerência e Alice porque a tabela estava vazia. Novos perfis recebem UUID no servidor.

## Migração SQL

As migrações aditivas em `database/migrations/` ativam RLS no esquema inicial, configuram políticas, adicionam tarefas e registos de higienização e saldos de férias inicialmente vazios, e criam RPCs para alterar quantidades e configurar artigos.

- Stock: a colaboradora só recebe permissão de atualizar a coluna `quantity`; criação e edição de configuração passam por `configure_stock_item`, que exige `manager` ou `owner`. Atualizações de quantidade deixam um movimento de inventário.
- Férias/encerramentos: o mapa `collective_closure_days` permite leitura por perfis ativos e escrita só a `manager`/`owner` via API e RLS. A interface não aceita pedidos individuais; feriados aparecem como encerrado sem contar como férias, e dias classificados pela Gerência como férias coletivas contam como férias. As tabelas legadas `leave_requests` e `leave_balances` ficam preservadas.
- Horários, assiduidade e fichas: as políticas só autorizam `manager`/`owner`.
- HACCP: utilizadores ativos autenticados podem consultar e submeter registos; colaboradoras só podem submeter com o seu próprio `staff_id`. Os registos existentes não são reescritos.
- Higienização: tarefas ativas são consultáveis; registos são append-only para a colaboradora. `add_monthly_cleaning_task` exige gerência. A lista inicial é inserida com `on conflict do nothing`.

O Edge Function `preguica-auth` verifica os PINs no servidor com bcrypt, cria sessões opacas com validade de 12 horas e aplica um bloqueio após tentativas incorretas. O hash e as sessões não são legíveis pela chave publicável. A chave privilegiada é lida pelo runtime do Supabase e nunca é enviada ao browser. A função valida no servidor as operações de gestão de utilizadores; apenas o proprietário pode criar outra conta de gerência. Desativar uma conta revoga as suas sessões e preserva o histórico.

## Autenticação e PINs pedidos

O ecrã permite escolher utilizador e introduzir PIN. Os valores iniciais não estão em texto simples no repositório; apenas hashes bcrypt estão na base de dados. O token fica em `sessionStorage`, é opaco, guardado como hash no servidor e termina após 12 horas. A lista pública devolve apenas IDs e nomes ativos. A sessão não deve ser tratada como MFA; recomenda-se PIN mais longo e renovar os PINs iniciais após a primeira entrada.

## Higienização e manual

O menu HACCP inclui um modelo geral para café/bar com bebidas alcoólicas e não alcoólicas e tostas; o manual oficial aprovado continua a prevalecer. A grelha mensal de temperaturas regista manhã/tarde e identifica quem submeteu. A grelha de higienização regista conclusões por tarefa/dia, responsável, data/hora, produto e observações. Não são definidos limites de temperatura pela aplicação. A migração define as tarefas base:

- Diárias: bancadas/superfícies, chão, instrumentos e utensílios.
- Semanais: vidros, pó, teias de aranha e frigoríficos.
- Mensais: paredes, teto, candeeiros, congelador e zona do armazém.

O registo persistente, responsável, data/hora, observações e produto usado são escritos em `cleaning_records` pela API autenticada. A coluna JSON existente `checklist_data` guarda manhã/tarde nos registos de temperatura, sem migração adicional.

## Mapa anual de encerramentos

O mapa anual semeia 1, 8, 24, 25 e 31 de dezembro de 2026 conforme indicação da Gerência. Dias 1, 8 e 25 são feriados obrigatórios no Código do Trabalho; 24 e 31 foram classificados como férias coletivas. A aplicação exporta os encerramentos do ano selecionado como `.ics` para importação na agenda.

## Publicação Vercel

O portal oficial está publicado em [preguicamanager-web.vercel.app](https://preguicamanager-web.vercel.app/), no projeto `preguicamanager-web`. O site estático tem raiz `Preguica_Manager_v2/web`; operações autenticadas passam pelo Edge Function `preguica-auth` no projeto Supabase `hmuzfvmpstejcnyiwbtx`. A publicação atual foi promovida do ramo `codex/preguica-release-20261029`. A ausência do aviso de pré-produção na interface indica que o portal está em produção; não substitui a revisão contínua de segurança e dados operacionais.

As versões de desenvolvimento devem ser verificadas em preview antes de nova promoção. Não guardar chaves privadas no browser.

## Verificação e segurança residual

Verificações funcionais feitas antes da publicação e pontos de segurança a acompanhar:

1. Staff consegue ler e criar registos HACCP próprios; não consegue forjar `staff_id` nem editar/apagar histórico.
2. Staff consegue ler inventário e compras, atualizar `quantity`, e recebe erro ao tentar alterar mínimo, fornecedor, preço ou criar artigo.
3. Staff consegue consultar o mapa anual de encerramentos, mas recebe 403 ao tentar adicionar, alterar ou remover datas. As operações de férias individuais e saldos ficam fora da interface.
4. Staff não consegue ler horários, assiduidade, fichas técnicas ou auditoria.
5. Staff consegue inserir histórico de higiene e leituras de temperatura apenas em seu nome; não consegue editar/apagar o histórico nem adicionar tarefa mensal.
6. Manager e owner conseguem executar operações de gestão permitidas. A conta owner mantém leitura/escrita sobre os dados anteriores.

Testes reais do Edge Function confirmaram login de Alice, leitura HACCP, escrita de temperatura e higienização por Alice, 403 para adicionar tarefa mensal por Alice, adição mensal por Gerência e leitura posterior na grelha API. As três linhas de QA foram removidas após o teste; não restaram registos HACCP/higiene de teste. Falta testar a interface visual completa e concluir horários, assiduidade e alertas.
