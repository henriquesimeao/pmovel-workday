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

## Dependências de dados (gaps conhecidos)

A classificação completa (especialmente **demissão**) e alguns campos
obrigatórios dependem de dados que **não vêm pela REST de recurso do Workday**
(ver `docs/de-para-workday-pmovel.md`): `hireDate`, `terminationDate`, `active`,
legal entity (CNPJ) e national ID (CPF). Hoje o `getConsolidatedWorker` deixa
esses campos ausentes; quando a origem (WQL liberado ou SOAP) estiver definida,
o `WorkdayClient.getConsolidatedWorker` será estendido para preenchê-los — sem
mudar o job nem o orquestrador.

Enquanto isso:
- workers sem `active=false`/`terminationDate` são tratados como admissão/atualização;
- `cnpj` exige o de/para em `cnpj_mapping`; sem ele, o item falha (registrado), e o
  lote segue;
- `employeegroup_code`/`syndicate_code`/`workday_code` usam o default configurado
  em `mapping.config` até você definir a origem/de-para.

## Testes

- Unitários: consolidação do worker, classificação (create/update/inactivate/skip),
  upsert com fallback (`employee-sync.job.spec.ts`).
- E2e: fluxo admissão → atualização → demissão, idempotência e falha de item
  isolada (`test/employees-phase1.e2e-spec.ts`), com Workday e Pmovel mockados.
