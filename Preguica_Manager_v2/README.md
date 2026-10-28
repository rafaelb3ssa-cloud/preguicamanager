# Preguiça Manager v2

## Estado atual

A branch liga autenticação por PIN, perfis, stock/compras, férias, HACCP/higiene e fichas técnicas ao Supabase através do Edge Function. PINs usam hashes bcrypt e sessões opacas expiram após 12 horas. Existem os perfis iniciais Gerência e Alice. Horários, assiduidade e alertas ainda estão em demonstração; a aplicação não está pronta para produção. O mapa de férias é coletivo e lista datas de encerramento, distinguindo feriados de férias coletivas.

Os módulos originais foram mantidos. Os dados de painel, horários, assiduidade e alertas continuam ilustrativos. O inventário e saldos de férias no novo projeto não foram inventados: a gerência deve confirmar e inserir os valores reais.

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

O menu HACCP inclui um modelo de referência para café/bar (bebidas com e sem álcool e tostas) e separadores de Manual, Temperaturas, Higienização e Checklists. O manual oficial aprovado pelo estabelecimento continua a prevalecer e a aplicação não inventa limites. Temperaturas usam uma grelha mensal com equipamento, manhã/tarde e rubrica; higienização usa uma grelha por tarefa/dia, mais histórico de produto e observações. As 12 tarefas-base ficam na base de dados. A base tem atualmente zero registos de temperaturas e zero conclusões de limpeza; não foram importados valores ilegíveis da fotografia. O mapa anual tem as cinco datas de dezembro de 2026 indicadas pela Gerência: 1, 8 e 25 como feriados; 24 e 31 como férias coletivas. O mapa pode ser exportado como ficheiro `.ics` para importar na agenda.

A quantidade sugerida a comprar deve ser calculada como `max(0, mínimo configurado - quantidade atual)`. O artigo guarda unidade, fornecedor e custo quando estes dados existem.

## Antes de produção

1. O projeto Supabase `hmuzfvmpstejcnyiwbtx` foi criado na região `eu-central-1` (Frankfurt), na organização “Preguiça Manager”; a cotação consultada na criação foi 0 USD/mês. O projeto estava vazio e as migrações iniciais foram aplicadas. Confirmar os custos atuais no painel Supabase porque podem mudar com o uso/plano.
2. Ligar horários, assiduidade e alertas às tabelas através de operações server-side com autorização por função.
3. Não há artigos reais nem saldos laborais confirmados no novo projeto. As cinco datas de encerramento de dezembro de 2026 foram inseridas no mapa; os pedidos/saldos antigos continuam preservados nas tabelas legadas. Nenhum dado anterior foi eliminado ou copiado.
4. Completar testes de cada módulo com Gerência e Alice e confirmar que tentativas não autorizadas são recusadas pelo servidor/base de dados.
5. Confirmar backups/restauro, raiz/build Vercel e os dados reais do inventário antes de publicar em produção.
