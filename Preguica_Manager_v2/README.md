# Preguiça Manager v2

## Estado atual

Esta pasta contém uma interface HTML estática de demonstração e um esquema PostgreSQL. Existe agora um projeto Supabase vazio de dados reais, com as migrações iniciais aplicadas. A interface ainda não está ligada à base de dados: continua sem autenticação/API e a maior parte dos registos existe apenas durante a sessão do navegador; as fichas técnicas também usam `localStorage` neste dispositivo. Ainda não está pronta para produção.

O protótipo inclui painel, stock/compras, horários, férias, assiduidade, HACCP/higiene, fichas técnicas e alertas. Estes módulos foram mantidos. Os artigos e exemplos presentes no HTML não são uma base de dados de produção e não devem ser tratados como inventário ou registos oficiais.

A página `web/index.html` agora inclui as 76 fichas do ZIP, com pesquisa, filtro por categoria, edição e exportação CSV. Os custos são referências estimadas e devem ser validados com faturas e receitas reais; alterações continuam apenas neste navegador.

## Abrir a demonstração

Abrir `web/index.html` num navegador atualizado. Não requer instalação. A demonstração não autentica utilizadores nem sincroniza dados entre dispositivos.

## Segurança e migração

O esquema de base de dados inicial não ativava RLS. As migrações aditivas em `database/migrations/` ativam as políticas por função, funções RPC de inventário, tarefas/histórico de higienização e vistas limitadas de férias. Não eliminam tabelas ou linhas existentes. Confirmar a conta `owner` antes de produção.

A migração não cria utilizadores nem configura os PINs. Os PINs iniciais pedidos (gerência `4040`, colaboradora `2026`) não estão no código nem na base de dados. Só devem ser configurados depois de existir autenticação no servidor, proteção contra tentativas repetidas e um procedimento seguro de troca/recuperação. Um PIN de quatro dígitos não é suficiente como proteção isolada contra tentativas online.

Para o modelo de funções, permissões e próximos passos de publicação, consultar `SECURITY_AND_DEPLOYMENT.md`.

## Vercel

Não foi encontrada configuração Vercel versionada (`vercel.json`, `.vercel/project.json`) nem configuração de build (`package.json`). O preview da branch foi construído com sucesso e serve esta demonstração estática. A raiz/configuração efetiva deve ser confirmada antes de alterar o build. A demonstração não está protegida por RLS: RLS só protege pedidos autenticados à base de dados.

## HACCP e stock

O manual oficial aprovado pelo estabelecimento continua a ser a referência. A demonstração não inventa limites de temperatura. As tarefas de higienização semeadas pela migração são diárias (bancadas/superfícies, chão, instrumentos/utensílios), semanais (vidros, pó, teias de aranha, frigoríficos) e mensais (paredes, teto, candeeiros, congelador, armazém). O histórico só fica disponível depois de uma API autenticada usar as tabelas novas.

A quantidade sugerida a comprar deve ser calculada como `max(0, mínimo configurado - quantidade atual)`. O artigo guarda unidade, fornecedor e custo quando estes dados existem.

## Antes de produção

1. O projeto Supabase `hmuzfvmpstejcnyiwbtx` foi criado na região `eu-central-1` (Frankfurt), na organização “Preguiça Manager”; a cotação consultada na criação foi 0 USD/mês. O projeto estava vazio e as migrações iniciais foram aplicadas. Confirmar os custos atuais no painel Supabase porque podem mudar com o uso/plano.
2. Implementar autenticação e API de servidor; a base de dados ainda não está ligada à interface nem ao Vercel. Não configurar os PINs iniciais até a autenticação ter hashing e limitação de tentativas.
3. Não há artigos reais nem saldos confirmados no novo projeto. Importar dados apenas após validação do proprietário; nenhum dado anterior foi eliminado ou copiado.
4. Executar os testes SQL de permissões numa instância staging com perfis de teste para `owner`, `manager` e `staff`; os testes atuais de `manager` e `staff` usaram fixtures transacionais revertidas.
5. Ligar a interface às operações autenticadas e persistentes; testar os módulos existentes e confirmar backups/restauro.
6. Confirmar raiz/build Vercel e dados com o proprietário antes de publicar em produção.
