# Preguiça Manager v2 — protótipo funcional de interface

## Incluído nesta versão
- Stock com quantidades mínimas e lista de compras sugerida.
- Horário semanal em grelha, com ação de “publicar” demonstrativa.
- Pedidos de férias e decisão de gerente.
- Registos de assiduidade (entradas/saídas, atrasos, faltas, baixas e saídas antecipadas) com validação/correção demonstrativa.
- Registo de temperaturas, checklist de higiene e registos HACCP recentes.
- Fichas técnicas com preço de venda, custo de ingredientes, ingredientes, método e alergénios.
- Painel com alertas de exemplo.
- Esquema inicial PostgreSQL em `database/schema.sql`.

## Como abrir
Abrir `web/index.html` num browser atualizado. Não precisa de instalação.

## Limitações importantes
Esta é uma demonstração de interface, não uma aplicação online multiutilizador. Os dados ficam apenas na memória do browser e perdem-se ao atualizar/fechar. “Publicar” não envia o horário a colaboradoras; os alertas não são enviados por SMS/email/push. Não há autenticação, anexos, base de dados, backups nem permissões reais. Não usar para substituir registos legais/HACCP nem como registo laboral oficial.

## Próxima fase para produção
1. Autenticação individual e perfis owner/manager/staff.
2. Base de dados central e regras de acesso por função (RLS), testadas.
3. Publicação/versionamento do horário e notificações.
4. Tarefa agendada diária para detetar HACCP/higiene em falta, com regras por dia/turno e alertas ao gerente.
5. Alertas de stock baixo e exportação da lista de compras.
6. Trilho de auditoria imutável para alterações de assiduidade e HACCP.
7. Política de privacidade, acessos limitados a dados de baixas e retenção definida.
8. Testes funcionais, segurança, cópias de segurança e validação com contabilista/consultor HACCP.

## Regras de negócio a validar
- Limites de temperatura e frequência de cada registo segundo o plano HACCP efetivo do Café Preguiça.
- Se os mínimos de stock devem disparar quando quantidade fica abaixo ou igual ao mínimo.
- Como contar férias e gerir sobreposições/feriados e aprovação.
- Bases de IVA e custos nas fichas técnicas.
