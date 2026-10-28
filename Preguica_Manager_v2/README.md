# Preguiça Manager v2

## Estado atual

Esta branch já tem entrada por utilizador/PIN e gestão de utilizadores ligadas ao Supabase. A autenticação é validada no Edge Function, os PINs são guardados como hashes bcrypt e as sessões expiram ao fim de 12 horas. Estão criadas as contas iniciais Gerência e Alice. Os restantes módulos continuam em demonstração e ainda não sincronizam os dados com a base de dados; a aplicação não está pronta para produção.

O protótipo inclui painel, stock/compras, horários, férias, assiduidade, HACCP/higiene, fichas técnicas e alertas. Estes módulos foram mantidos. Os artigos e exemplos presentes no HTML não são uma base de dados de produção e não devem ser tratados como inventário ou registos oficiais.

As 76 fichas de referência do ZIP ficam na tabela `product_recipes` e só a Gerência as carrega pela API. Os custos são estimativas e devem ser validados com faturas e receitas reais; alterações feitas pela Gerência passam a ser guardadas na base de dados.

## Abrir a pré-visualização

Abrir a URL de pré-visualização da branch Vercel. O HTML chama o Edge Function do Supabase para autenticar. A pré-visualização mostra um aviso sobre os módulos que continuam demonstrativos.

## Segurança e migração

O esquema de base de dados inicial não ativava RLS. As migrações aditivas em `database/migrations/` ativam as políticas por função, funções RPC de inventário, tarefas/histórico de higienização e vistas limitadas de férias. Não eliminam tabelas ou linhas existentes. Confirmar a conta `owner` antes de produção.

As migrações de identidade criam sessões e bloqueio progressivo, sem guardar PIN em texto simples. Para alterar o PIN de uma colaboradora, abre Equipa e seleciona Editar. A desativação preserva histórico e termina as sessões da conta.

Para o modelo de funções, permissões e próximos passos de publicação, consultar `SECURITY_AND_DEPLOYMENT.md`.

## Vercel

Não foi encontrada configuração Vercel versionada (`vercel.json`, `.vercel/project.json`) nem configuração de build (`package.json`). O preview da branch foi construído com sucesso e serve esta demonstração estática. A raiz/configuração efetiva deve ser confirmada antes de alterar o build. A demonstração não está protegida por RLS: RLS só protege pedidos autenticados à base de dados.

## HACCP e stock

O manual oficial aprovado pelo estabelecimento continua a ser a referência. A demonstração não inventa limites de temperatura. As tarefas de higienização semeadas pela migração são diárias (bancadas/superfícies, chão, instrumentos/utensílios), semanais (vidros, pó, teias de aranha, frigoríficos) e mensais (paredes, teto, candeeiros, congelador, armazém). O histórico só fica disponível depois de uma API autenticada usar as tabelas novas.

A quantidade sugerida a comprar deve ser calculada como `max(0, mínimo configurado - quantidade atual)`. O artigo guarda unidade, fornecedor e custo quando estes dados existem.

## Antes de produção

1. O projeto Supabase `hmuzfvmpstejcnyiwbtx` foi criado na região `eu-central-1` (Frankfurt), na organização “Preguiça Manager”; a cotação consultada na criação foi 0 USD/mês. O projeto estava vazio e as migrações iniciais foram aplicadas. Confirmar os custos atuais no painel Supabase porque podem mudar com o uso/plano.
2. Ligar o stock, horários, férias, assiduidade, HACCP/higiene, fichas técnicas e alertas às tabelas através de operações server-side com autorização por função.
3. Não há artigos reais nem saldos confirmados no novo projeto. Importar dados apenas após validação do proprietário; nenhum dado anterior foi eliminado ou copiado.
4. Testar cada módulo com Gerência e Alice e confirmar que tentativas não autorizadas são recusadas pelo servidor/base de dados.
5. Confirmar backups/restauro, raiz/build Vercel e os dados reais do inventário antes de publicar em produção.
