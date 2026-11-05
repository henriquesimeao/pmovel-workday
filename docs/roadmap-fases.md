# Roadmap — Fases 2, 3 e 4

A Fase 1 (colaboradores, Workday → Pmovel) está implementada
(ver `docs/fase-1-colaboradores.md`). As próximas fases reaproveitam a mesma
fundação: `SyncOrchestrator`, `PhaseSyncJob`, `JobRegistry`, os clientes
(`WorkdayClient`/`PmovelClient`) e a persistência (`sync_run`/`sync_item`/
`sync_cursor`). Cada fase é um novo `PhaseSyncJob` registrado no `JobRegistry`.

## Como uma nova fase se encaixa

1. Criar `src/phases/<fase>/<fase>-sync.job.ts` implementando `PhaseSyncJob`.
2. Criar o `<Fase>Module`, importar `SyncModule` + clientes + mapeamento, e
   registrar o job no `onModuleInit` (igual ao `EmployeesModule`).
3. Importar o módulo no `AppModule`.
4. O job fica disparável via `POST /sync/<fase>/<tipo>` e pelo scheduler.

## Fase 2 — Horas extras e verbas de folha (Pmovel → Workday)

**Direção:** Pmovel é a origem, alimenta o Workday.

- **Origem (Pmovel):** `POST /v3/reports/event_totals` (`EventTotalsDto`), que
  retorna, por colaborador e período de apuração (`AAAAMM`), os eventos
  totalizados (`codigo_evento`, `descricao_evento`, `qtd_horas`, `qtd_decimal`,
  competência). É a verba/hora extra já processada no Pmovel.
- **Destino (Workday):** lançamento de *payroll inputs* / *time tracking*. A
  escrita no Workday exige domínios/escopos de **Time Tracking** e/ou folha
  (ver `docs/workday-novo-cliente.md`) com permissão de `Put`/`Modify`, além do
  endpoint REST de destino (a detalhar na descoberta da fase).
- **Mapeamento:** de/para entre `codigo_evento` (Pmovel) e o tipo de ganho/
  earning code do Workday. Correlação do colaborador pelo mesmo `external_id`
  usado na Fase 1.
- **Job sugerido:** `payroll-events:full` (`phase=payroll-events`, `type=full`),
  parametrizado por período de apuração.

## Fase 3 — Férias (direção configurável)

- **Recursos Pmovel:** `/v3/vacations` (CRUD completo + listagem por intervalo
  com `ListVacationsResponseDto`).
- **Direção configurável:** Pmovel origem, Workday origem, ou **bidirecional**.
  Um job bidirecional **se decompõe em dois `PhaseSyncJob`** independentes
  (ex.: `vacations:wd-to-pm` e `vacations:pm-to-wd`), cada um com seu cursor, em
  vez de um job "dois sentidos" — mais simples de operar e auditar.
- **Ponto de configuração de direção:** uma variável/config por fase (ex.:
  `VACATIONS_DIRECTION=wd_to_pm | pm_to_wd | both`) decide quais jobs o módulo
  registra no `JobRegistry`.

## Fase 4 — Afastamentos (direção configurável)

- **Recursos Pmovel:** `/v3/absences` (CRUD + listagem por intervalo com
  `AbsenceAllResponse`, incluindo `justification_code`, `cid`, etc.).
- **Direção configurável:** igual à Fase 3 — decomposição em dois jobs quando
  bidirecional, com config `ABSENCES_DIRECTION`.
- **Observação:** há também relatórios correlatos no Pmovel
  (`/v3/reports/unjustified_absences`) que podem compor a lógica de
  afastamentos/ausências injustificadas.

## Escopos/domínios do Workday para escrita (Fases 2-4)

As fases que **gravam** no Workday precisam, além de `View`/`Get` (leitura),
das permissões de `Put`/`Modify` nos domínios correspondentes, e do escopo da
área funcional no API Client — ver a seção de domínios e o aviso sobre escrita em
`docs/workday-novo-cliente.md`.

## Pontos de extensão já prontos na fundação

- `PhaseSyncJob` + `JobRegistry`: adicionar fase = adicionar job.
- `BaseRestClient`: novos recursos do Pmovel/Workday reutilizam token-cache,
  retry e paginação.
- `FieldMappingService`/`mapping.config`: o de/para configurável (direct/lookup/
  default) serve a qualquer fase.
- `sync_run`/`sync_item`/`sync_cursor`: rastreabilidade e diffs já cobrem todas
  as fases.
- `cnpj_mapping`: de/para legal entity ↔ CNPJ reutilizável onde o CNPJ for
  necessário.
