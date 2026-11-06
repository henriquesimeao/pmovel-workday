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
  `mapping.config` **apenas na admissão**; na **atualização não são enviados**
  (`immutableOnUpdate`), para não sobrescrever ajustes feitos manualmente no Pmovel;
- `cpf` vem de `nationalIdentifiers`; ausente em parte do tenant de demo (EUA), mas
  presente em tenant BR.

### Campos imutáveis na atualização

Alguns campos são definidos só na admissão e **nunca** reenviados no `PUT` de
atualização, porque podem ter sido ajustados manualmente no Pmovel. Hoje:
`employeegroup_code`, `syndicate_code`, `workday_code` (lista
`immutableOnUpdate` em `src/mapping/mapping.config.ts`). O `EmployeeMapper.toUpdateDto`
remove esses campos do corpo do update.

## Testes

- Unitários: consolidação do worker, classificação (create/update/inactivate/skip),
  upsert com fallback (`employee-sync.job.spec.ts`).
- E2e: fluxo admissão → atualização → demissão, idempotência e falha de item
  isolada (`test/employees-phase1.e2e-spec.ts`), com Workday e Pmovel mockados.

## Validação na API local do Pmovel (dev)

A Fase 1 foi executada de ponta a ponta contra o Workday real e a API local do
Pmovel (cliente `workday`, 4 empresas).

**1ª execução (`POST /sync/employees/full`):** 112 workers lidos.

| Resultado | Qtde | Detalhe |
|---|---:|---|
| Criados (`POST`) | 74 | ativos prontos |
| Atualizados | 1 | colaborador criado antes, no teste de gravação |
| Ignorados | 30 | demitidos que nunca existiram no Pmovel |
| Falhas | 7 | ver abaixo |

**2ª execução (idempotência):** 75 atualizações, 0 criações duplicadas, mesmas 7
falhas e 30 ignorados.

**Falhas esperadas** (registradas em `sync_item`, o lote continua):
- 4 sem documento no Workday (3 também sem e-mail): `cpf` ausente.
- 3 com e-mail ou documento que **já pertence a outro colaborador** no Pmovel
  (`Employee with email X or CPF Y already exists`). Provavelmente a mesma pessoa
  em duas empresas do Workday. É uma regra de negócio a decidir: o Pmovel não aceita
  o mesmo e-mail/documento em dois cadastros.

### O que a API do Pmovel exigiu e confirmou

- **Grupo, sindicato e jornada**: enviar `_code` **e** `_name`. Com os dois, o
  Pmovel cadastra sozinho o que não existir. Só com o `_code` ele responde
  `Employee group with code X not found` (e `...and employee group name was not sent`).
  O integrador envia `DEFAULT` / `DEFAULT` na admissão (`mapping.config`).
- **Campo editado à mão não é sobrescrito**: o grupo foi alterado manualmente para
  outro código e continuou igual após o `PUT` do integrador.
- **Documento estrangeiro no campo `cpf`** e **e-mail gerado** foram aceitos.
- **Nomes ficam em maiúsculas** no Pmovel (a API normaliza). O integrador não
  compara nomes, então não há efeito.
- **Dois erros de "já existe" diferentes**: `Employee with external_id X already
  exists` (o integrador cai para `PUT`) e `Employee with email X or CPF Y already
  exists` (erro real, não vira `PUT`). O detector de duplicidade só aceita o primeiro.

