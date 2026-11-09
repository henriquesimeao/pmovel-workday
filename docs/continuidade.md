# Continuidade: onde paramos e como retomar

> **Leia este documento primeiro.** Ele resume o estado do projeto, como colocar o
> ambiente de pé, o que já foi decidido, o que aprendemos de difícil e o que falta.
> Os outros documentos em `docs/` têm o detalhe de cada tema (índice no fim).

## 1. Resumo

Aplicação **NestJS + TypeScript** que integra **Workday** e **Pmovel** por REST, em
fases:

| Fase | Fluxo | Conteúdo | Situação |
|---|---|---|---|
| **1** | Workday → Pmovel | Colaboradores: admissão, atualização, demissão | **Implementada e validada em dev**, com pendências (seção 7) |
| 2 | Pmovel → Workday | Horas extras e verbas de folha | Não iniciada (roadmap) |
| 3 | Configurável | Férias | Não iniciada |
| 4 | Configurável | Afastamentos | Não iniciada |

O plano original de 10 tarefas (fundação + Fase 1 + roadmap) foi concluído. Depois
dele, o trabalho foi de **validação contra sistemas reais** e de ajustes de regra
de negócio, listados na seção 5.

**Números do estado atual**
- 127 testes unitários e 8 e2e passando; build e lint sem erros (6 avisos de `any`).
- Código em `main`, sincronizado com o GitHub (`henriquesimeao/pmovel-workday`).
- Última execução real em dev (run 4): 112 workers lidos → **75 atualizados,
  30 demitidos ignorados (nunca existiram no Pmovel), 7 falhas** (todas esperadas,
  ver seção 4).

## 2. Como retomar (do zero)

### Pré-requisitos
- Node.js 20.6+ (testado em Node 25) e npm.
- MySQL local com o database `integration_workday` e um usuário com acesso.
- API do Pmovel de desenvolvimento rodando em `http://127.0.0.1:3000`.
  O código dela está em `~/Documents/htdocs/pmovel/pmovel_rest_api_nestjs` (útil
  para entender mensagens de erro: veja a seção 6).
- Acesso ao tenant Workday de dev `wwglgmcdcl_extdev`.

### Passo a passo
```bash
npm install
cp .env.example .env          # preencha (variáveis abaixo)
npm run migration:run         # cria as 4 tabelas no MySQL
npm run build
node --env-file=.env dist/main.js     # ou: npm run start:dev
curl http://127.0.0.1:3001/health     # {"status":"ok",...}
curl -X POST http://127.0.0.1:3001/sync/employees/full   # dispara a Fase 1
curl http://127.0.0.1:3001/sync/runs/<runId>             # resultado detalhado
```

> A aplicação roda na porta **3001**, porque a **3000 é da API do Pmovel**.

### Variáveis do `.env`
Nomes (os valores estão só no `.env`, que **não** vai para o git):

| Grupo | Variáveis |
|---|---|
| Aplicação | `NODE_ENV`, `PORT` (use `3001` em dev) |
| Workday | `WorkdayTenant`, `WorkdayTenantUrl`, `WorkdayServicesUrl` (opcional), `WorkdayClientId`, `WorkdayClientSecret`, `WorkdayRefreshToken` |
| Pmovel | `PmovelBaseUrl`, `PmovelAccessKeyId`, `PmovelSecretAccessKey` |
| MySQL | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` |
| Sync | `SYNC_CRON`, `SYNC_SCHEDULE_ENABLED` (default `false`) |

Em dev: Pmovel em `http://127.0.0.1:3000` com o client `workday`; banco
`integration_workday` em `127.0.0.1`. A aplicação **recusa subir** com variável
obrigatória ausente.

### Comandos
| Comando | Uso |
|---|---|
| `npm test` / `npm run test:e2e` | testes unitários / ponta a ponta |
| `npm run lint` | ESLint (roda `--fix`) |
| `npm run migration:run` / `migration:revert` | aplica / desfaz migrations |
| `npm run ref:test:connection` | testa o Workday com o código JS original |

## 3. Estado do ambiente de desenvolvimento

Útil para saber o que já existe antes de rodar qualquer coisa.

- **MySQL `integration_workday`**: migration `InitialSchema` aplicada (schema
  conferido contra as entidades: 0 divergências). Tabelas: `sync_run`, `sync_item`,
  `cnpj_mapping`, `sync_cursor`.
  - `sync_run` tem as runs 1 a 4 (todas `completed`; nenhuma presa em `running`).
  - `cnpj_mapping` tem as 4 empresas (abaixo). **Esses dados não estão no git.**
- **De/para de CNPJ** (empresa do Workday → CNPJ do cliente no Pmovel):

  | Chave (`legalEntityId`) | Empresa | CNPJ |
  |---|---|---|
  | `NLE USA` | Next Level Enterprises (USA) | `00111111000100` |
  | `NLE CAN` | Next Level Enterprises, Ltd (Canada) | `00111111000200` |
  | `9dff7a68…` (id interno; essa empresa não tem `company_ID`) | Next Level Enterprises, PLC (UK) | `00111111000300` |
  | `ASI` | Advanced Solutions, Inc. (USA) | `00111111000400` |

- **Pmovel de dev (cliente `workday`)**: tem **75 colaboradores criados pelo
  integrador**, nos 4 clientes acima. O `external_id` 21411 foi usado nos testes de
  escrita (já restaurado ao estado normal: ativo, grupo `DEFAULT`).
- **Workday de dev**: tenant de demonstração, com 112 workers (82 ativos, 30
  demitidos), documentos todos estrangeiros (SSN, SIN, NINO), nenhum CPF brasileiro.

## 4. Resultado da última execução (run 4) e itens pendentes de ação

| Resultado | Qtde |
|---|---:|
| Atualizados | 75 |
| Demitidos ignorados (nunca foram admitidos) | 30 |
| Falhas | 7 |

As 7 falhas, todas por regra e **nenhuma é bug**:

| Worker | Motivo | O que fazer |
|---|---|---|
| 100006, 100010, 21511 | sem documento e sem e-mail | RH completar o cadastro no Workday |
| 21047 | sem documento | RH completar o cadastro no Workday |
| 100011 | documento `000000000` (recusado por regra) | corrigir o documento no Workday |
| **21624** | **TRATAMENTO MANUAL**: e-mail já usado pelo 21135 (outra empresa) | decisão de negócio: pessoa em duas empresas (ver seção 6) |
| **21609** | **TRATAMENTO MANUAL**: `AB123456C` ou o e-mail já existe | **consulta pendente** no banco do Pmovel (abaixo) |

**Pendência aberta:** descobrir o que bloqueia o 21609. A hipótese é que o Pmovel
compara também a versão só com dígitos (`123456`) e há um colaborador ativo com esse
valor. Consulta a rodar no banco do Pmovel:

```sql
SELECT * FROM users
WHERE (email = 'sarah.hill@workday.net' OR cpf IN ('AB123456C', '123456'))
  AND e_removed = 0 AND e_active = 1 AND permission IN (0, 1);
```

Já verificado: nenhum registro com o e-mail, nenhum com o documento `AB123456C`, e a
tabela `users` só tem a chave primária como índice único (não é restrição do banco).

## 5. O que foi feito (linha do tempo resumida)

1. **Descoberta e plano**: leitura do código JS de referência, API do Pmovel (OpenAPI
   fornecido) e decisões de arquitetura (NestJS, MySQL/TypeORM, API REST nos dois
   lados, disparo agendado e sob demanda, falhas por item sem abortar o lote).
2. **Fundação (tasks 1 a 8)**: config tipada, `BaseRestClient`, `WorkdayClient`,
   `PmovelClient`, persistência, mapeamento, `SyncOrchestrator`, controller e
   scheduler.
3. **Fase 1 (task 9)** e **documentação (task 10)**.
4. **WQL**: a REST de recurso do Workday não traz datas, status, empresa nem
   documento. Liberamos o domínio WQL, o escopo System e geramos novo refresh token.
   A leitura passou a ser uma única query WQL.
5. **Regras de negócio definidas com o usuário** (seção 6).
6. **Validação em sistemas reais**: migration em MySQL real; gravação na API local do
   Pmovel (criação, atualização, demissão e reativação); lote completo e repetição
   (idempotência comprovada).
7. **Correções descobertas na validação**: ver "Armadilhas" (seção 8).

## 6. Decisões e regras de negócio (e por quê)

| Decisão | Motivo |
|---|---|
| Integrar por API, não por banco | preserva contratos e regras de cada sistema |
| `external_id` = `employeeID` do Workday | legível, estável, e é a chave natural do Pmovel |
| Falha de um item não aborta o lote | só o item vira falha em `sync_item` |
| Cada empresa do Workday = um cliente do Pmovel, com CNPJ próprio | regra do usuário; de/para na tabela `cnpj_mapping` |
| Empresa sem de/para: o item falha (não cria no cliente errado) | a mensagem diz qual empresa cadastrar |
| Grupo, sindicato e jornada: `DEFAULT`/`DEFAULT` (code e name) **só na admissão** | sem equivalente no Workday; o Pmovel cadastra sozinho com `_code` + `_name` |
| Esses três campos **nunca** vão no `PUT` (`immutableOnUpdate`) | podem ter sido alterados à mão no Pmovel; comprovado na API real |
| Campo `cpf`: CPF brasileiro (só dígitos); senão o documento principal estrangeiro; **sem espaços** | regra do usuário |
| Documento `000000000` é recusado (a pessoa não é integrada) | já existe pessoa com esse valor no Pmovel, causa conflito |
| Sem e-mail no Workday: gera `<documento>@<empresa>.com` | e-mail é obrigatório no Pmovel; regra do usuário |
| E-mail gerado **não** é reenviado no `PUT` | pode ter sido corrigido à mão |
| `PUT` não envia campos vazios | string vazia apagaria o dado no Pmovel |
| Demitido: sempre consultar o Pmovel; inativar só se existir e estiver ativo | regra do usuário; quem nunca foi admitido não é integrado |
| Conflito de e-mail/CPF com outra pessoa: **tratamento manual** | regra do usuário; log com os valores em destaque |

**Pessoa em duas empresas** (caso 21624): o Pmovel não aceita o mesmo e-mail/CPF em
dois cadastros ativos, em qualquer cliente. Decisão atual: **falha, tratamento
manual**. A alternativa seria o time do Pmovel aceitar o mesmo e-mail em clientes
diferentes.

## 7. Pendências e riscos (por prioridade)

### Prioridade alta (afetam correção ou operação)
1. **Readmissão não é tratada.** Se um colaborador inativo no Pmovel volta a ficar
   ativo no Workday, o job faz só um `PUT` e ele **continua inativo, sem aviso**
   (conta como sucesso). Falta chamar `reactivateEmployeeByExternalId` (o cliente já
   tem) quando `existing.active === false` e o worker está ativo. O Pmovel também tem
   `join_history` para readmissão/transferência (ver `employees.service.ts`).
2. **Run presa em `RUNNING` bloqueia tudo.** O lock é a existência de uma run
   `running`. Se a aplicação cair no meio (ou o banco falhar ao gravar um item), a run
   nunca fecha e as próximas chamadas retornam 409. Não há `try/finally` nem
   recuperação de run velha. Destravar à mão:
   ```sql
   UPDATE sync_run SET status = 'failed', finishedAt = NOW(),
          errorMessage = 'interrompida' WHERE status = 'running';
   ```
   Correção sugerida: `try/finally` no orquestrador e expirar runs `running` antigas.
3. **O `POST /sync/...` só responde quando a run termina.** Com 112 workers leva
   poucos segundos; em tenant grande vai estourar o timeout. Sugerido: responder logo
   com o `runId` e executar em segundo plano (o `GET /sync/runs/:id` já serve para
   acompanhar).

### Prioridade média
4. **Sem diff incremental.** O cursor (`sync_cursor`) é gravado, mas `fetchItems`
   ignora o `since`: toda execução lê tudo e faz uma consulta ao Pmovel por worker.
   Para volume alto, filtrar no WQL por data de alteração.
5. **`country` fixo em `BR`.** Os workers de EUA, Canadá e Reino Unido vão como `BR`.
   Buscar o país no WQL (ex.: `primaryWork_Country`) quando importar.
6. **Campos não mapeados**: `job_position` recebe o `jobCode` (código, não o título),
   e `manager_external_id`, `is_hr_manager`, `home_office`, `job_level`, `job_family*`,
   `gmt` ficam fora.
7. **`cnpj_mapping` só existe no banco**, sem seed versionado nem endpoint. Em outro
   ambiente é preciso inserir os pares à mão. Candidato: um seed por ambiente ou um
   endpoint de administração.
8. **E-mail gerado usa um domínio inventado** (`...@empresa.com`). Se o Pmovel enviar
   notificações por e-mail, elas irão para endereços que não existem. Vale confirmar
   com o time do Pmovel.
9. **Grupo, sindicato e jornada** seguem `DEFAULT`. Em produção, definir se haverá
   de/para por dimensão do Workday. A config suporta (modos `direct`/`lookup`/`default`).

### Prioridade baixa
10. O agendador (`SYNC_SCHEDULE_ENABLED`) está **desligado** e nunca rodou de verdade
    (só testes unitários).
11. Os 6 avisos de lint são `any` no parsing das linhas do WQL.
12. O `.env` de dev contém credenciais antigas (usuário/senha do Workday que o código
    não usa e client id/secret comentados). Limpar quando for conveniente. O arquivo
    não é versionado.
13. Todo o trabalho foi commitado direto na `main`.

## 8. Armadilhas aprendidas (leia antes de mexer)

**Workday**
- A REST de recurso **não** traz `hireDate`, `terminationDate`, status, empresa nem
  documento. Use **WQL**.
- WQL exige **três camadas**: domínio *Workday Query Language (WQL)* no grupo de
  segurança (View **e** Get), escopo **System** no API Client (com *Include Workday
  Owned Scope = Sim*), e um **refresh token novo** depois de mudar o escopo. Sem
  qualquer uma: `403 S22`. Passo a passo em `docs/workday-novo-cliente.md`.
- Na REST, `Get Only` sozinho não basta; precisa de `View Only`.
- WQL: o limite de página é **100** (`limit` maior dá 400). O data source que inclui
  demitidos é `allActiveAndTerminatedWorkers`.
- `nationalIdentifiers` vem como `{id, descriptor}`. **O `id` é um hash interno, não o
  documento.** O número está no `descriptor` (`"123-45-6789 (USA-SSN)"`). Usar o `id`
  mandaria um hash como CPF sem ninguém notar.
- `company_ID` pode vir vazio (empresa do Reino Unido); aí usa-se o id interno da
  `company`.

**Pmovel**
- Grupo/sindicato/jornada: enviar `_code` **e** `_name`, senão `... not found`.
- A API devolve **404 para lista vazia** (`listEmployees` trata como `[]`).
- Nomes são gravados em **maiúsculas** (não é bug).
- Duas mensagens "já existe" diferentes: `external_id X already exists` (vira `PUT`) e
  `email X or CPF Y already exists` (conflito real). Nunca tratar as duas igual: isso
  já escondeu a causa e gerou um `PUT` sem sentido.
- A checagem de e-mail/CPF é **global, só de ativos não removidos**, e para
  documento não numérico compara também **só os dígitos** (`AB123456C` → `123456`).
  A mensagem cita sempre o e-mail e o CPF enviados, não o valor que colidiu.
- O código do Pmovel usa remoção lógica (`e_removed`). O `PUT` em um `external_id` que
  não existe responde "not found or already removed" (visto para quem nunca foi criado).

**Ambiente e ferramentas**
- Porta 3000 é da API do Pmovel; esta aplicação usa **3001**.
- No zsh, um glob sem correspondência (`rm discovery-output/*.json`) aborta o comando
  inteiro. O `--include` do `grep` também deu problema; usar `grep -rn` com aspas.
- O Jest recente não tem `fail()`; usar `await expect(...).rejects`.
- O `eslint --fix` (prettier) reformata arquivos de `src/`. Se um `replace` automático
  não achar o texto, releia o arquivo antes.
- Scripts temporários com dados reais ficam em `discovery-output/` (ignorada pelo git
  e apagada ao fim de cada uso). **Não imprima nome, documento ou data de nascimento**
  reais em saídas que ficam registradas; mascare.

## 9. Próximos passos sugeridos

1. Rodar a consulta do 21609 (seção 4) e decidir: limpar o registro, manter manual, ou
   pedir o ajuste do `getCpfs` no Pmovel.
2. Tratar a **readmissão** (pendência 1), com teste unitário e validação na API local.
3. Blindar o orquestrador (pendência 2) e responder o `POST` de forma assíncrona
   (pendência 3).
4. Trazer `country` real e o título do cargo no WQL (pendências 5 e 6).
5. Implementar o diff incremental (pendência 4) quando o volume exigir.
6. Habilitar e observar o agendador em dev (pendência 10).
7. **Preparar homologação/produção**: seguir `docs/workday-novo-cliente.md` no tenant
   do cliente, definir o de/para de CNPJ real e os valores de grupo/sindicato/jornada
   (pendências 7 e 9), e revisar o e-mail gerado (pendência 8).
8. **Fase 2** (Pmovel → Workday: horas extras e verbas): origem
   `POST /v3/reports/event_totals`; falta descobrir o destino de escrita no Workday e
   liberar permissões de escrita. Ver `docs/roadmap-fases.md`. A fundação
   (`PhaseSyncJob`, `JobRegistry`, clientes, persistência) já suporta uma nova fase.

## 10. Mapa do código

```
src/
  config/        env.validation.ts (Joi), app-config.service.ts, config.module.ts
  common/http/   base-rest-client.ts (token, retry 401, paginação), rest-client.error.ts
  workday/       workday.client.ts (REST + WQL), consolidated-worker.ts, __fixtures__
  pmovel/        pmovel.client.ts (login JWT + employees), pmovel.types.ts
  persistence/   entities/, migrations/, repositórios, data-source.ts (CLI)
  mapping/       mapping.config.ts (regras), employee.mapper.ts, field-mapping.service.ts,
                 cnpj-mapping.service.ts
  sync/          sync.orchestrator.ts, phase-sync-job.ts, job-registry.ts,
                 sync.controller.ts, sync.scheduler.ts, manual-review.error.ts
  phases/employees/  employee-sync.job.ts, employees.module.ts
  health/        health.controller.ts
test/            e2e (sync.e2e-spec.ts, employees-phase1.e2e-spec.ts)
src/*.js         código JS de referência original (preservado)
```

Onde mexer para cada assunto:
- **Regra de um campo do Pmovel**: `src/mapping/mapping.config.ts` e
  `src/mapping/employee.mapper.ts`.
- **O que é lido do Workday**: `WorkdayClient.EMPLOYEES_WQL` e `consolidateFromWql`.
- **Lógica criar/atualizar/demitir**: `src/phases/employees/employee-sync.job.ts`.
- **Lote, falhas, lock, resumo no log**: `src/sync/sync.orchestrator.ts`.

## 11. Consultas úteis (MySQL do integrador)

```sql
-- Últimas execuções
SELECT id, status, totalCount, successCount, failureCount, skippedCount, startedAt
FROM sync_run ORDER BY id DESC LIMIT 10;

-- Falhas da última execução
SELECT externalId, errorMessage FROM sync_item
WHERE status = 'failure' AND run_id = (SELECT MAX(id) FROM sync_run);

-- Itens para tratamento manual (última execução)
SELECT externalId, errorMessage FROM sync_item
WHERE errorMessage LIKE 'TRATAMENTO MANUAL%' AND run_id = (SELECT MAX(id) FROM sync_run);

-- De/para de CNPJ
SELECT legalEntityId, legalEntityName, cnpj, active FROM cnpj_mapping;
```

## 12. Índice da documentação

| Documento | Para quê |
|---|---|
| `docs/continuidade.md` | este documento |
| `docs/arquitetura.md` | camadas, componentes e decisões de projeto |
| `docs/fase-1-colaboradores.md` | fluxo da Fase 1, validações reais, tratamento manual, regra de duplicidade do Pmovel |
| `docs/de-para-workday-pmovel.md` | cada campo do Pmovel, de onde vem, regras de `cpf` e e-mail |
| `docs/banco-de-dados.md` | tabelas, migrations e operação do MySQL |
| `docs/workday-novo-cliente.md` | configurar um tenant Workday do zero (ISU, grupo, domínios, WQL, API Client) |
| `docs/roadmap-fases.md` | Fases 2, 3 e 4 |
| `docs/referencia-workday-rest.md` | código JS original e histórico da prova de conceito |
