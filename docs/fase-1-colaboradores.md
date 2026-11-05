# Fase 1 — Colaboradores (Workday → Pmovel)

Sincroniza colaboradores do **Workday** (origem) para o **Pmovel** (destino):
admissões, atualizações e demissões, num único job (`employees:full`).

## Fluxo

```
Workday (listWorkers + getConsolidatedWorker)
      │
      ▼
EmployeeSyncJob.processItem(worker)
      │
      ├─ worker inativo/terminado ──► Pmovel.inactivate(external_id, dt_demissao)   [DEMISSÃO]
      │
      ├─ não existe no Pmovel ──────► Pmovel.create (upsert: 409 → update)          [ADMISSÃO]
      │
      └─ existe e ativo ────────────► Pmovel.update(external_id, dto)               [ATUALIZAÇÃO]
```

- **Chave de correlação:** `external_id` (derivado do worker pela config de
  mapeamento; default = `workerId`).
- **Idempotência:** admissão faz upsert; reprocessar não duplica. Atualização e
  demissão checam o estado atual no Pmovel antes de agir.
- **Política de falhas:** cada item é processado isoladamente; falhas (ex.: CNPJ
  sem de/para, campo obrigatório ausente) são registradas em `sync_item` e o lote
  continua.

## Como disparar

Sob demanda (HTTP):

```bash
curl -X POST http://localhost:3000/sync/employees/full
# { "runId": 1, "phase": "employees", "type": "full" }

curl http://localhost:3000/sync/runs/1
# run com status, contadores e itens (sucesso/falha por external_id)
```

Agendado: defina `SYNC_SCHEDULE_ENABLED=true` e `SYNC_CRON` no `.env`.

## Origem dos dados (via WQL)

O `fetchItems` lê os workers com uma única query **WQL** no data source
`allActiveAndTerminatedWorkers` (`WorkdayClient.listConsolidatedWorkersViaWql`),
trazendo ativos e terminados com todos os campos da Fase 1: `employeeID`,
`hireDate`, `terminationDate`, `currentlyActive`, `company_ID` (legal entity),
`primaryWork_Email`, `dateOfBirth`, `isManager`, `jobCode`, `nationalIdentifiers`.

Validado no tenant de dev: 112 workers (82 ativos + 30 terminados), `hireDate` e
`company_ID` em 100%. Requer o domínio WQL + escopo System no API Client
(ver `docs/workday-novo-cliente.md`).

**Campos ainda por configurar** (negócio, não técnico):
- `cnpj` exige o de/para em `cnpj_mapping` (legal entity `company_ID` → CNPJ); sem
  ele, o item falha (registrado) e o lote segue;
- `employeegroup_code`/`syndicate_code`/`workday_code` usam o default em
  `mapping.config` até você definir o valor/de-para;
- `cpf` vem de `nationalIdentifiers`; ausente em parte do tenant de demo (EUA), mas
  presente em tenant BR.

## Testes

- Unitários: consolidação do worker, classificação (create/update/inactivate/skip),
  upsert com fallback (`employee-sync.job.spec.ts`).
- E2e: fluxo admissão → atualização → demissão, idempotência e falha de item
  isolada (`test/employees-phase1.e2e-spec.ts`), com Workday e Pmovel mockados.
