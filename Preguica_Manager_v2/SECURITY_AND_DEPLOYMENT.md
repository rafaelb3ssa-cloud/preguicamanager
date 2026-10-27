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

O proprietário mantém acesso total através do perfil ativo `owner`. A migração não atualiza nem elimina perfis ou linhas existentes. Antes de aplicar RLS, confirmar que o perfil do proprietário está ligado ao respetivo `auth.users.id`, ativo e com função `owner`; caso contrário, a aplicação poderá deixar de ver linhas protegidas.

## Migração SQL

`database/migrations/20261027_01_roles_hygiene_stock.sql` é aditiva: ativa RLS no esquema inicial, configura políticas, adiciona tarefas e registos de higienização e saldos de férias inicialmente vazios, e cria RPCs para alterar quantidades e configurar artigos.

- Stock: a colaboradora só recebe permissão de atualizar a coluna `quantity`; criação e edição de configuração passam por `configure_stock_item`, que exige `manager` ou `owner`. Atualizações de quantidade deixam um movimento de inventário.
- Férias: leitura direta da tabela e escrita só para gerência. As vistas `staff_leave_calendar` e `staff_leave_balances` expõem à colaboradora apenas os dados de férias e saldo, sem notas pessoais de outros tipos de ausência. Os saldos não recebem valores fictícios.
- Horários, assiduidade e fichas: as políticas só autorizam `manager`/`owner`.
- HACCP: utilizadores ativos autenticados podem consultar e submeter registos; colaboradoras só podem submeter com o seu próprio `staff_id`. Os registos existentes não são reescritos.
- Higienização: tarefas ativas são consultáveis; registos são append-only para a colaboradora. `add_monthly_cleaning_task` exige gerência. A lista inicial é inserida com `on conflict do nothing`.

RLS não autentica a interface estática. A aplicação precisa de autenticação real e de chamadas autenticadas à base de dados. Nunca enviar uma chave `service_role` ao browser. As chaves privadas devem permanecer em variáveis de ambiente do servidor e não estão presentes nesta branch.

## Autenticação e PINs pedidos

O protótipo não tem login. Os valores iniciais pedidos — gerência `4040` e colaboradora `2026` — não foram incorporados em HTML, SQL ou JavaScript. Ainda não há serviço de autenticação nem uma API server-side para os configurar. Antes de ativar esses PINs, é necessário implementar armazenamento de hash, limitação e bloqueio progressivo de tentativas, sessão segura, procedimento de troca e auditoria. A implementação não deve validar PIN apenas em JavaScript.

## Higienização e manual

A demonstração agora encaminha para o manual HACCP oficial aprovado e não classifica temperaturas com limites inventados. O manual do estabelecimento continua a prevalecer. A migração define as tarefas base:

- Diárias: bancadas/superfícies, chão, instrumentos e utensílios.
- Semanais: vidros, pó, teias de aranha e frigoríficos.
- Mensais: paredes, teto, candeeiros, congelador e zona do armazém.

O registo persistente, responsável, data/hora, observações e produto usado estão modelados em `cleaning_records`; falta a interface/API autenticada que os utiliza.

## Vercel e passos de produção

Não há `vercel.json`, `.vercel/project.json` ou `package.json` na pasta `Preguica_Manager_v2`. O README existente aponta para `web/index.html`, mas a raiz atualmente configurada no painel Vercel não é acessível neste repositório. Confirmar a raiz do projeto e a configuração de build diretamente no painel; não inferir que o protótipo está protegido por estar alojado na Vercel.

Não foi encontrada base de dados de produção no projeto. Nenhum serviço foi criado e nenhum recurso externo foi alterado. Supabase é uma opção a avaliar, sujeita a autorização do proprietário quanto à criação do projeto, região, plano/custos e acesso às credenciais. Se aprovado, usar as variáveis de ambiente do servidor para segredos. O browser pode receber apenas configuração pública e tokens de sessão; a autorização continua a ser validada pela base de dados/API.

## Verificação necessária em staging

Antes da aplicação em produção, criar utilizadores de teste ligados a perfis `owner`, `manager` e `staff` e verificar:

1. Staff consegue ler e criar registos HACCP próprios; não consegue forjar `staff_id` nem editar/apagar histórico.
2. Staff consegue ler inventário e compras, atualizar `quantity`, e recebe erro ao tentar alterar mínimo, fornecedor, preço ou criar artigo.
3. Staff consegue consultar as vistas de férias, mas não selecionar/escrever diretamente em `leave_requests` ou editar saldos.
4. Staff não consegue ler horários, assiduidade, fichas técnicas ou auditoria.
5. Staff consegue inserir histórico de higiene apenas em seu nome; não consegue editar/apagar o histórico nem adicionar tarefa mensal.
6. Manager e owner conseguem executar operações de gestão permitidas. A conta owner mantém leitura/escrita sobre os dados anteriores.

Não foi possível executar testes SQL nesta alteração porque não existe uma instância PostgreSQL/Supabase ou configuração de produção ligada ao workspace. A migração ainda precisa de ser aplicada e testada numa instância staging antes de ser considerada pronta.
