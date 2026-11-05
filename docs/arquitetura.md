# Arquitetura — Integração Pmovel ↔ Workday

Aplicação integradora em **NestJS + TypeScript** que sincroniza dados entre
**Workday** e **Pmovel** via REST API, em fases. Este documento descreve a
arquitetura-alvo e é atualizado conforme as tasks avançam.

## Visão geral

```
CRON (@nestjs/schedule) ─┐
                         ├─► SyncOrchestrator ─► EmployeeSyncJob (Fase 1)
HTTP SyncController ──────┘   (lote, falhas)       │
                                                   ├─ lê workers + detalhe ─► WorkdayClient (OAuth refresh_token)
                                                   ├─ mapeia ─► EmployeeMapper + FieldMappingService + CnpjMappingService
                                                   └─ escreve ─► PmovelClient (/v3, JWT login)

SyncOrchestrator ─► MySQL/TypeORM: sync_run, sync_item, cnpj_mapping, sync_cursor
```

## Fases da integração

| Fase | Fluxo | Dados | Endpoints Pmovel |
|---|---|---|---|
| **1** | Workday → Pmovel | Admissões, atualizações, demissões de colaboradores | `/v3/employees` (CRUD + inactivate/reactivate) |
| **2** | Pmovel → Workday | Horas extras e verbas de folha processadas | `POST /v3/reports/event_totals` |
| **3** | Configurável | Férias | `/v3/vacations` |
| **4** | Configurável | Afastamentos | `/v3/absences` |

A Fase 1 é o escopo detalhado atual; as demais estão no roadmap
(ver `docs/roadmap-fases.md`, criado na Task 10).

## Estrutura de pastas

```
src/
  main.ts, app.module.ts
  config/                 ConfigModule + validação Joi + AppConfigService (fachada tipada)
  common/http/            BaseRestClient (token-cache, retry 401, paginação)
  common/logging/
  workday/                WorkdayClient, tipos de worker
  pmovel/                 PmovelClient, DTOs
  persistence/            entidades + migrations (sync_run, sync_item, cnpj_mapping, sync_cursor)
  mapping/                FieldMappingService, CnpjMappingService, EmployeeMapper, mapping.config
  sync/                   SyncOrchestrator, SyncController, scheduler, PhaseSyncJob
  phases/employees/       EmployeeSyncJob
  health/                 HealthController
docs/
  arquitetura.md              (este arquivo)
  referencia-workday-rest.md  código JS de referência
  workday-novo-cliente.md     setup do tenant Workday
  de-para-workday-pmovel.md   mapeamento de campos (Task 4)
  roadmap-fases.md            Fases 2-4 (Task 10)
src/*.js                  código de referência (preservado, não é o alvo final)
```

## Cliente REST base (`common/http/BaseRestClient`)

Classe abstrata que concentra a mecânica comum aos dois clientes (Workday e
Pmovel), portada do `src/workday-rest.js` de referência:

- **Cache de token** com renovação ao expirar (`getAccessToken`).
- **Retry único em 401**: renova o token e repete a chamada uma vez.
- **Erros tipados**: `RestClientError` com `status` e `body` (o `body` permite
  ao chamador detectar, por exemplo, "já existe" no upsert da Fase 1).
- **Paginação em dois estilos**:
  - `paginateOffset` — coleções `{ data, total }` com `limit`/`offset` (Workday).
  - `paginatePage` — arrays por página com `page`/`limit` (Pmovel).

A obtenção do token é um *template method* (`fetchToken`): cada subclasse
implementa o seu fluxo — `refresh_token` + Basic auth no Workday,
`POST /v3/auth/login` no Pmovel. Mensagens de erro expõem apenas o `pathname`
da URL, nunca a query string (evita vazar parâmetros sensíveis em logs).

## Cliente Workday (`workday/WorkdayClient`)

Estende o `BaseRestClient`. Porta `src/config.js` + `src/workday-rest.js`:

- `resolveServicesHost`: converte o host da UI para `-services1` (ou usa
  `WorkdayServicesUrl`).
- `fetchToken`: `grant_type=refresh_token` com Basic auth (clientId:secret).
- `resolveUrl`: paths relativos a `/ccx/api/` com `{tenant}` substituído.
- Métodos: `listWorkers()` (paginado), `getWorkersPage()`, `getWorker(id)`,
  `getResource()`/`paginateResource()` (sub-recursos e expansões, usados na
  descoberta da Task 4 e pelos mapeadores).

Validado contra o tenant de dev `wwglgmcdcl_extdev`: retorna os 82 workers,
mesma saída do código de referência.

## Cliente Pmovel (`pmovel/PmovelClient`)

Estende o `BaseRestClient`. Autenticação por JWT:

- `fetchToken`: `POST /v3/auth/login` com `{ access_key_id, secret_access_key }`
  → `access_token`. A expiração do cache é extraída do claim `exp` do próprio
  JWT (`computeExpiry`), com fallback de 1h e margem de 60s.
- Métodos de Employees (Fase 1): `createEmployee`, `updateEmployeeByExternalId`,
  `inactivateEmployeeByExternalId`, `reactivateEmployeeByExternalId`,
  `getEmployeeByExternalId` (retorna `null` em 404, para a decisão de upsert) e
  `listEmployees` (paginação `page`/`limit`).

DTOs tipados a partir do OpenAPI v3.0.59 em `pmovel/pmovel.types.ts`.

## Decisões de projeto

- **Integração via API, não banco direto.** O integrador é cliente de duas APIs
  REST (Workday e Pmovel). Não acessa bancos internos de nenhum dos sistemas,
  preservando contratos e regras de negócio.
- **Chave de correlação: `external_id`.** A API Pmovel indexa colaboradores por
  `external_id`. Na Fase 1 (Workday → Pmovel), o `external_id` é um identificador
  do worker no Workday (campo configurável). Isso torna o upsert e a idempotência
  diretos, sem necessidade de uma tabela de mapeamento de IDs para correlação.
- **Política de falhas: continua o lote.** Uma falha em um item é registrada em
  `sync_item` e o processamento segue; o lote não é abortado.
- **Idempotência.** Admissão faz upsert (POST → PUT se já existe); reprocessar um
  lote não duplica registros.
- **Configuração tipada e fail-fast.** O ambiente é validado no boot (Joi); a app
  recusa subir com `.env` incompleto. Nenhum `process.env` fora de `config/`.

## Configuração de ambiente

Todas as variáveis estão documentadas em `.env.example`. Grupos:

- **Workday**: `WorkdayTenant`, `WorkdayTenantUrl`, `WorkdayServicesUrl` (opcional),
  `WorkdayClientId`, `WorkdayClientSecret`, `WorkdayRefreshToken`.
- **Pmovel**: `PmovelBaseUrl`, `PmovelAccessKeyId`, `PmovelSecretAccessKey`.
- **MySQL**: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- **Sync**: `SYNC_CRON`, `SYNC_SCHEDULE_ENABLED`.

O `.env` nunca é versionado (`.gitignore`). As credenciais são lidas apenas pela
camada `config/` e nunca logadas.

## Segurança e PII

- CPF e data de nascimento são PII. A documentação de de/para registra apenas
  **nomes/caminhos de campos**, nunca valores reais. Fixtures de teste são
  anonimizadas. Dados capturados na descoberta ficam em `discovery-output/`
  (ignorado pelo git).

## Status por task

| Task | Descrição | Status |
|---|---|---|
| 1 | Scaffold NestJS + configuração tipada | ✅ concluída |
| 2 | BaseRestClient (token-cache, retry, paginação) | ✅ concluída |
| 3 | WorkdayClient | ✅ concluída |
| 4 | Descoberta do schema + de/para | ✅ concluída (ver decisões pendentes no de/para) |
| 5 | PmovelClient | ✅ concluída |
| 6 | Persistência MySQL (TypeORM) | ✅ concluída (migration não aplicada contra MySQL real — ver docs/banco-de-dados.md) |
| 7 | Camada de mapeamento | pendente |
| 8 | SyncOrchestrator + gatilhos | pendente |
| 9 | EmployeeSyncJob (Fase 1) | pendente |
| 10 | Documentação + roadmap | pendente |
