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

## Demissões: regra e validação

Para cada worker demitido no Workday, o integrador **sempre consulta o Pmovel**
(`GET` por `external_id`) antes de agir:

| Situação no Pmovel | Ação |
|---|---|
| Não existe | ignora (`inexistente no Pmovel`): quem nunca foi admitido não é integrado |
| Existe e está ativo (admitido) | `inactivate` com a data de demissão do Workday |
| Existe e já está inativo | ignora (`já inativo`), sem inativar de novo |

Validado na API real (dev) com um colaborador de teste: demitido inexistente foi
ignorado; demitido admitido foi inativado (`active=false`, `dt_demissao` gravada);
repetir a demissão foi ignorado como `já inativo`; a reativação
(`reactivate` com `clean_dt_demissao`) devolveu o colaborador ao estado original.

## Conflitos de e-mail/documento (investigação)

Das 3 falhas `Employee with email X or CPF Y already exists`:

- **21624 (UK)**: é duplicata dentro do próprio Workday. O **21135 (Canadá)** tem o
  mesmo nome, o mesmo e-mail e a mesma data de admissão, ambos ativos, mas data de
  nascimento e documento diferentes. O Pmovel já tem o 21135 e rejeita o 21624 por
  e-mail repetido. É o cenário "mesma pessoa em duas empresas" (ou cadastro
  duplicado no Workday).
- **21609 (UK)** e **100011 (Canadá)**: não há outro worker com o mesmo e-mail,
  documento ou nome no Workday, e nenhum dos 75 colaboradores do Pmovel visíveis à
  credencial tem esse e-mail/documento (nem comparando só os dígitos). O conflito é
  com um registro que a credencial não enxerga: outro cliente do Pmovel de
  desenvolvimento ou um colaborador removido. O e-mail e o documento em conflito
  estão em `sync_item.errorMessage` desses `external_id`, para consulta no banco do Pmovel.

## Atualização: o que é e o que não é enviado

O `PUT` da atualização:

- **não envia** `cnpj`, `external_id` nem os campos de `immutableOnUpdate`
  (grupo, sindicato e jornada, com `_code` e `_name`);
- **não envia o e-mail gerado** (só o e-mail real do Workday);
- **não envia campos vazios**: uma string vazia apagaria o dado no Pmovel;
- **recusa quem tem documento inválido** (`000000000`), como na criação.

### Execução de 05/11 (dev)

Com o `cpf` sem espaços e a recusa de `000000000`: 75 atualizações (corrigindo o
`cpf` dos 75 cadastros que tinham espaços; conferido na API: 0 com espaço, 0 com
`000000000`), 30 demitidos ignorados e 7 falhas: 4 sem documento, o 100011
(`documento inválido`) e o 21609 e 21624 (e-mail/documento já usados por outro
cadastro, tratamento manual).

