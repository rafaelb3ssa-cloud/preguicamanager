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
- Férias: leitura direta da tabela e escrita só para gerência. As vistas `staff_leave_calendar` e `staff_leave_balances` expõem à colaboradora apenas os dados de férias e saldo, sem notas pessoais de outros tipos de ausência. Os saldos não recebem valores fictícios.
- Horários, assiduidade e fichas: as políticas só autorizam `manager`/`owner`.
- HACCP: utilizadores ativos autenticados podem consultar e submeter registos; colaboradoras só podem submeter com o seu próprio `staff_id`. Os registos existentes não são reescritos.
- Higienização: tarefas ativas são consultáveis; registos são append-only para a colaboradora. `add_monthly_cleaning_task` exige gerência. A lista inicial é inserida com `on conflict do nothing`.

O Edge Function `preguica-auth` verifica os PINs no servidor com bcrypt, cria sessões opacas com validade de 12 horas e aplica um bloqueio após tentativas incorretas. O hash e as sessões não são legíveis pela chave publicável. A chave privilegiada é lida pelo runtime do Supabase e nunca é enviada ao browser. A função valida no servidor as operações de gestão de utilizadores; apenas o proprietário pode criar outra conta de gerência. Desativar uma conta revoga as suas sessões e preserva o histórico.

## Autenticação e PINs pedidos

O ecrã permite escolher utilizador e introduzir PIN. Os valores iniciais não estão em texto simples no repositório; apenas hashes bcrypt estão na base de dados. O token fica em `sessionStorage`, é opaco, guardado como hash no servidor e termina após 12 horas. A lista pública devolve apenas IDs e nomes ativos. A sessão não deve ser tratada como MFA; recomenda-se PIN mais longo e renovar os PINs iniciais após a primeira entrada.

## Higienização e manual

A demonstração agora encaminha para o manual HACCP oficial aprovado e não classifica temperaturas com limites inventados. O manual do estabelecimento continua a prevalecer. A migração define as tarefas base:

- Diárias: bancadas/superfícies, chão, instrumentos e utensílios.
- Semanais: vidros, pó, teias de aranha e frigoríficos.
- Mensais: paredes, teto, candeeiros, congelador e zona do armazém.

O registo persistente, responsável, data/hora, observações e produto usado estão modelados em `cleaning_records`; falta a interface/API autenticada que os utiliza.

## Vercel e passos de produção

Não há `vercel.json`, `.vercel/project.json` ou `package.json` na pasta `Preguica_Manager_v2`. O README existente aponta para `web/index.html`, mas a raiz atualmente configurada no painel Vercel não é acessível neste repositório. Confirmar a raiz do projeto e a configuração de build diretamente no painel; não inferir que o protótipo está protegido por estar alojado na Vercel.

Foi criado o projeto Supabase `hmuzfvmpstejcnyiwbtx` na organização “Preguiça Manager”, em Frankfurt. A cotação devolvida no momento da criação foi 0 USD/mês. A base não recebeu artigos, utilizadores laborais adicionais ou saldos inventados. Estão aplicados o esquema e as migrações de funções, higiene, férias e PIN. Os únicos perfis são Gerência e Alice. Confirmar custos atuais no painel Supabase, pois dependem do plano e utilização.

Esta entrega liga apenas a entrada por PIN e a gestão de utilizadores à base de dados. Os módulos de stock, horários, férias, assiduidade, HACCP/higiene, fichas e alertas continuam demonstrativos e não têm persistência da interface. O aviso de pré-produção aparece na aplicação. Não usar esses módulos como registos oficiais nem promover a branch até ligar e testar cada operação persistente e a respetiva autorização server-side. O browser contém apenas a chave publicável.

As 76 fichas vindas do ZIP aparecem na demonstração como dados de referência. Custos e margens não foram confirmados; alterações guardadas no navegador não entram na base de dados.

## Verificação necessária em staging

Antes da aplicação em produção, criar utilizadores de teste ligados a perfis `owner`, `manager` e `staff` e verificar:

1. Staff consegue ler e criar registos HACCP próprios; não consegue forjar `staff_id` nem editar/apagar histórico.
2. Staff consegue ler inventário e compras, atualizar `quantity`, e recebe erro ao tentar alterar mínimo, fornecedor, preço ou criar artigo.
3. Staff consegue consultar as vistas de férias, mas não selecionar/escrever diretamente em `leave_requests` ou editar saldos.
4. Staff não consegue ler horários, assiduidade, fichas técnicas ou auditoria.
5. Staff consegue inserir histórico de higiene apenas em seu nome; não consegue editar/apagar o histórico nem adicionar tarefa mensal.
6. Manager e owner conseguem executar operações de gestão permitidas. A conta owner mantém leitura/escrita sobre os dados anteriores.

Os testes reais do Edge Function confirmaram PIN incorreto recusado, login de Alice e Gerência, 403 de gestão para Alice, e criação, edição, desativação e bloqueio de login de uma conta temporária. A conta temporária foi removida após o teste. Falta testar cada módulo completo na interface e validar as permissões de dados nas operações API que ainda não foram implementadas.
