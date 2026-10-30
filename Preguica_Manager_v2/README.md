# Preguiça Manager v2

## Estado de produção

O portal oficial está publicado no projeto Vercel `preguicamanager-web`, em [preguicamanager-web.vercel.app](https://preguicamanager-web.vercel.app/). A versão de produção é promovida do ramo de publicação `codex/preguica-release-20261029`; a raiz do site é `Preguica_Manager_v2/web`. A aplicação usa o Supabase `hmuzfvmpstejcnyiwbtx` e a função server-side `preguica-auth`.

A autenticação por PIN e as operações sensíveis passam pelo Edge Function `preguica-auth`, com sessões opacas e autorização no servidor. PINs são armazenados como hashes; a chave service-role fica apenas no ambiente da Edge Function. O ecrã de login apresenta Gerência e cada perfil de colaboradora pelo nome; cada PIN identifica o respetivo perfil no servidor. Os PINs são hashes e podem ser alterados pela Gerência na gestão da equipa; o PIN nunca é validado só no browser. Na aplicação, esse perfil vê os módulos autorizados e consulta fichas técnicas publicadas. Qualquer colaborador pode sugerir uma correção numa ficha; a versão publicada só muda depois da aprovação da Gerência. Só a Gerência vê a fila de propostas, pode aprovar ou rejeitar, editar valores financeiros e gerir horários, férias e equipa. Os módulos usam operações persistentes na base de dados.

## Equipa e horários

Alice tem base semanal de 40 horas; Inês Machado, 40 horas; Inês Sequeira, 25 horas. Alice, Inês Machado e Inês Sequeira têm perfis individuais no login. Cada uma entra no próprio perfil; a Gerência pode alterar os PINs na gestão da equipa.

A grelha semanal permite inserir um ou mais intervalos por dia, guardar rascunhos, publicar para consulta da equipa e criar uma revisão de um horário publicado. Horas reais de turnos ainda devem ser preenchidas pela Gerência; não foram inventados horários.

## Férias coletivas de 2026

O mapa mostra os dias encerrados, distinguindo férias coletivas, folga semanal e feriados. Foram registados os períodos 2–18 de janeiro, 29 de junho–5 de julho e 3–6 de agosto. Também permanecem os encerramentos de dezembro: dias 1, 8, 24, 25 e 31.

O total anual é 22 dias de férias: 11 em janeiro, 5 em junho/julho, 4 em agosto e 2 em dezembro. Oito sábados/domingos aparecem como folga e não descontam férias; os três feriados registados não descontam férias. A agenda pode ser descarregada em `.ics`.

## Stock e fornecedores

A lista sugerida calcula `max(0, mínimo configurado - quantidade atual)` e mostra a diferença a comprar por artigo. A colaboradora pode atualizar quantidades reais e consultar/encomendar; apenas a Gerência pode criar ou editar artigos, mínimos, preços e fornecedores. Existem categorias para organizar o inventário.

Fornecedores e entregas registados: Recheio (segunda/terça), Sumol Compal (terça/quarta), Super Bock e gelo (quarta/quinta), pão, garrafeira e fruta (quinta/sexta). Telefones estão vazios porque não foram fornecidos.

O ficheiro Numbers recebido é um inventário de dezembro de 2025. Não foram importadas quantidades antigas como stock atual. Para importar nomes, categorias, unidades e custos sem quantidades, exportar o documento para Excel (`.xlsx`) ou CSV e enviá-lo.

## HACCP e higiene

O guia ilustrado para café/bar com bebidas com e sem álcool e tostas é complementar; o manual oficial aprovado do estabelecimento continua a ser a referência. Não são inventados limites de temperatura. As grelhas mensais de temperaturas e higienização mantêm o histórico existente. Foi acrescentado o registo cronológico de higienização das instalações com dia/hora, área/equipamento, responsável, rubrica, produto e observações. A confirmação individual de leitura/formação guarda colaborador, revisão do manual e data/hora no servidor.

Os equipamentos de frio são identificados como Frigo 1 (bar), Frigo 2 (cozinha), Arca 1 (congelador do armazém) e Arca 2 (congelador do gelo). Os nomes anteriormente usados nos registos históricos não são alterados.

## Encomendas diárias e receitas

O módulo Stock & compras passa a chamar-se Encomendas diárias. Cada produto existente pode ser selecionado e ter quantidade de encomenda registada por dia; a quantidade começa a zero quando ainda não existe encomenda guardada. A quantidade atual continua editável para inventário, enquanto mínimos, preços e fornecedores permanecem só para a gerência. As encomendas ficam em `daily_order_items` com RLS ativo e sem leitura direta por chaves públicas.

As fichas técnicas incluem uma área reservada para fotografia futura; o carregamento de imagens não está incluído nesta alteração. As propostas de alteração ficam numa tabela protegida sem acesso direto por chaves públicas. A Gerência aprova ou rejeita cada proposta; apenas a aprovação altera/cria a ficha publicada. Na grelha, a categoria aparece depois da breve história.

## Base de dados e alterações

O esquema e dados originais foram preservados. As migrações acrescentam os recursos da equipa, encomendas diárias, confirmações de formação e o fluxo de aprovação das fichas técnicas. As alterações com dados privados são mediadas pela função de servidor.

A segurança deve continuar a ser revista antes de promover a produção. O Supabase Security Advisor ainda aponta funções `SECURITY DEFINER` preexistentes acessíveis a `authenticated`; as tabelas `app_sessions` e `pin_login_attempts` têm RLS sem políticas e são usadas pelo serviço privilegiado de autenticação. Estes avisos não foram alterados nesta branch.

## Vercel

Não há `vercel.json`, `package.json` nem `.vercel/project.json` no repositório. O projeto Vercel existente está associado ao repositório e os previews desta branch servem a aplicação corretamente; nenhuma configuração de build ou raiz foi alterada. A produção foi construída pela Vercel com a raiz `Preguica_Manager_v2/web`; o deploy ficou READY e o alias principal foi confirmado.
