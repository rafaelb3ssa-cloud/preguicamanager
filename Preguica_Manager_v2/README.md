# Preguiça Manager v2

## Estado atual

Esta pasta contém uma interface HTML estática de demonstração e um esquema PostgreSQL inicial. Não existe ainda uma aplicação multiutilizador pronta para produção: não há autenticação, API de servidor, base de dados de produção, cópias de segurança nem permissões efetivas ligadas à interface. A maior parte dos registos existe apenas durante a sessão do navegador; as fichas técnicas também usam `localStorage` neste dispositivo.

O protótipo inclui painel, stock/compras, horários, férias, assiduidade, HACCP/higiene, fichas técnicas e alertas. Estes módulos foram mantidos. Os artigos e exemplos presentes no HTML não são uma base de dados de produção e não devem ser tratados como inventário ou registos oficiais.

## Abrir a demonstração

Abrir `web/index.html` num navegador atualizado. Não requer instalação. A demonstração não autentica utilizadores nem sincroniza dados entre dispositivos.

## Segurança e migração

O esquema de base de dados inicial não ativava RLS. A migração aditiva em `database/migrations/20261027_01_roles_hygiene_stock.sql` introduz as políticas por função, funções RPC de inventário e as tabelas de tarefas/histórico de higienização. Não elimina tabelas ou linhas existentes. A aplicação desta migração pode tornar as tabelas inacessíveis a clientes até que perfis ativos e funções sejam associados corretamente; validar primeiro em staging e confirmar a conta `owner` antes de produção.

A migração não cria utilizadores nem configura os PINs. Os PINs iniciais pedidos (gerência `4040`, colaboradora `2026`) não estão no código. Só devem ser configurados depois de existir autenticação no servidor, proteção contra tentativas repetidas e um procedimento seguro de troca/recuperação. Um PIN de quatro dígitos não é suficiente como proteção isolada contra tentativas online.

Para o modelo de funções, permissões e próximos passos de publicação, consultar `SECURITY_AND_DEPLOYMENT.md`.

## Vercel

Não foi encontrada configuração Vercel versionada (`vercel.json`, `.vercel/project.json`) nem configuração de build (`package.json`). O README original indicava `web/index.html`, mas não permite confirmar a raiz selecionada nas definições do projeto Vercel. Confirmar no painel Vercel que a raiz é `Preguica_Manager_v2` e rever a saída de build antes de qualquer publicação. A demonstração estática não deve ser apresentada como protegida por RLS: RLS só protege pedidos autenticados à base de dados.

## HACCP e stock

O manual oficial aprovado pelo estabelecimento continua a ser a referência. A demonstração não inventa limites de temperatura. As tarefas de higienização semeadas pela migração são diárias (bancadas/superfícies, chão, instrumentos/utensílios), semanais (vidros, pó, teias de aranha, frigoríficos) e mensais (paredes, teto, candeeiros, congelador, armazém). O histórico só fica disponível depois de uma API autenticada usar as tabelas novas.

A quantidade sugerida a comprar deve ser calculada como `max(0, mínimo configurado - quantidade atual)`. O artigo guarda unidade, fornecedor e custo quando estes dados existem.

## Antes de produção

1. Confirmar se existe base de dados de produção e inventariar/validar dados antes de qualquer migração. Não foi criada uma base de dados nesta alteração.
2. Provisionar uma base de dados/auth (por exemplo Supabase) apenas com autorização explícita para criar o recurso e aceitar os custos associados.
3. Implementar e rever a API de servidor e o fluxo de autenticação; não colocar credenciais privilegiadas no navegador.
4. Executar os testes SQL de permissões numa instância staging com perfis de teste para `owner`, `manager` e `staff`.
5. Ligar a interface às operações autenticadas e persistentes; testar os módulos existentes e confirmar backups/restauro.
6. Confirmar raiz/build Vercel e dados com o proprietário antes de publicar.
