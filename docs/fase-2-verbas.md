# Fase 2: verbas do ciclo (Pmovel → Workday)

Envia ao Workday, por colaborador e verba, as horas do ciclo apuradas no Pmovel.
O disparo é do RH, dentro do Pmovel. Decisões e histórico da descoberta:
[fase-2-planejamento.md](fase-2-planejamento.md). Rotas que o Pmovel precisa ter:
[fase-2-api-pmovel.md](fase-2-api-pmovel.md).

## Fluxo

```
RH no Pmovel cria a solicitação (global do ciclo fechado, ou individual de um demitido)
      │
PayrollExportPoller (a cada PAYROLL_EXPORT_POLL_SECONDS)
      ├─ GET  /v3/payroll_exports?status=pending&target=workday
      ├─ POST /v3/payroll_exports/{id}/start          ← 409: outro assumiu, pula
      ├─ SyncOrchestrator.run(PayrollExportJob)        ← 1 run por solicitação
      │     ├─ GET /v3/payroll_exports/{id}/totals    (todas as páginas)
      │     ├─ 1 item por colaborador × verba        → grava no Workday
      │     └─ verba enviada antes e que não veio    → grava 0
      └─ POST /v3/payroll_exports/{id}/finish          ← status, contadores, avisos, erros
```

A API Pmovel só responde; quem chama os dois sistemas é o integrador.

## Destinos no Workday

Escolhido por `PAYROLL_EXPORT_DESTINATION` (uma instância por tenant):

| Valor | Quando | Operação SOAP | Moeda |
|---|---|---|---|
| `payroll_input` | folha no Workday Payroll | `Submit_Payroll_Input` (serviço `Payroll`) | opcional |
| `external_payroll_input` | folha de terceiro (Payroll Interface) | `Put_External_Payroll_Input` (serviço `Payroll_Interface`) | **obrigatória** |

Os dois foram validados com gravação real no tenant de dev. Time Tracking ainda
não é destino (a API de horas reportadas não foi encontrada).

## Regras de cada lançamento

| Campo | Valor |
|---|---|
| Colaborador | `external_id` do Pmovel como `Employee_ID` (o `employeeID` do Workday) |
| Verba | `e_code` do Pmovel. `e_type = P` → `Earning_Code`; `D` → `Deduction_Code`. O cliente mantém os códigos iguais nos dois sistemas |
| Horas | `total_seconds / 3600`, 2 casas (mesmo arredondamento do Pmovel) |
| Datas | início e fim do ciclo do Pmovel |
| Id do lançamento | `PMV-<ciclo>-<colaborador>-<verba>`, com o id interno do colaborador no Pmovel |
| Lote | `PMV-<solicitação>` |
| Moeda | `cnpj_mapping.currency` da empresa |
| Comentário | `Pmovel: ciclo <início> a <fim>, solicitação <id>` |

**Reenvio não duplica.** O Workday atualiza o lançamento que tem o mesmo id.
Como o id não depende do escopo, o envio individual de alguém que já foi no global
também só atualiza. Não há operação de exclusão: verba que deixou de vir é
gravada com 0.

**O que é zerado num reenvio:**
- global: os lançamentos gravados antes por um envio **global** do ciclo que não
  vieram agora. Quem saiu inteiro do envio (ex.: demitido dentro do ciclo) entra
  nos avisos do resultado: os lançamentos dele foram zerados e ele precisa do
  envio individual;
- individual: os lançamentos do colaborador que não vieram agora.

Lançamentos já zerados não são reenviados.

## Resultado devolvido ao Pmovel

| `status` | Quando |
|---|---|
| `completed` | tudo gravado |
| `completed_with_errors` | parte falhou; `errors` lista colaborador, verba e a mensagem do Workday (ex.: verba que não existe, colaborador fora do grupo de folha) |
| `failed` | nada foi gravado; `error_message` diz por quê (ex.: moeda não configurada, API Pmovel fora) |

`summary`: `employees`, `inputs_sent`, `inputs_zeroed`, `failures`, `warnings`.

**Integrador reiniciado no meio de um envio:** ao subir, as solicitações que
ficaram `processing` são devolvidas como `failed` com a mensagem "interrompido:
... dispare o envio de novo". Reenviar é seguro (atualiza).

## Configuração

```env
PAYROLL_EXPORT_ENABLED=true
PAYROLL_EXPORT_POLL_SECONDS=60
PAYROLL_EXPORT_DESTINATION=external_payroll_input   # ou payroll_input
```

E a moeda de cada empresa no seed do de/para de CNPJ
(`seeds/cnpj-mapping/<ambiente>.json`, campo `currency`), aplicado com
`npm run seed:cnpj -- <arquivo>`.

## Permissões no Workday

No grupo da integração (`ISSG_Pmovel`), seção **Integration Permissions** do
domínio (a permissão de tela, View/Modify, não vale para web service):

| Destino | Domínio | Acesso | Escopo no API Client |
|---|---|---|---|
| `external_payroll_input` | Worker Data: Payroll Interface (Payroll Input by Worker) | Get e Put | Payroll Interface |
| `external_payroll_input` | Payroll Interface (verbas e grupos de folha externos) | Get | Payroll Interface |
| `payroll_input` | Worker Data: Payroll (Payroll Input) | Get e Put | Core Payroll |

Depois de mudar escopo, gerar refresh token novo. Não liberar *Implementation* nem
*Special OX Web Services* (acesso administrativo amplo).

## Banco do integrador

- `payroll_input_sent`: registro de envio, um por ciclo + colaborador + verba
  (o que foi enviado por último, com o id e o WID do Workday). Base para saber o
  que zerar num reenvio e para auditoria.
- `cnpj_mapping.currency`: moeda da empresa.
- Cada solicitação gera uma `sync_run` (`phase=payroll-events`, `type=export`,
  `trigger=pmovel`) com um `sync_item` por lançamento (`externalId` =
  `<external_id>/<verba>`).

## Validação em dev (25/11/2026)

Integrador completo contra o Workday real, com a API Pmovel simulada (as rotas
ainda não existem), colaborador 21079 (Canadá), verba `PMV_TESTE_HE`, destino
`external_payroll_input`, ciclo 15/06 a 14/07/2026:

| Envio | Resultado no `finish` | No Workday |
|---|---|---|
| 1,5 h + verba inexistente | `completed_with_errors`, 1 enviado, 1 erro com a mensagem do Workday | 1,5 h |
| 2,5 h | `completed` | atualizado para 2,5 h (mesmo lançamento) |
| colaborador não veio | `completed`, 1 zerado, 1 aviso | 0 h |

O registro de envio desse teste foi apagado do banco; o lançamento ficou com 0 h
no Workday. Os dois gravadores também foram conferidos isoladamente nos dois
destinos.

## Pendências

- **Rotas da API Pmovel** ([fase-2-api-pmovel.md](fase-2-api-pmovel.md)) e dados
  de teste em dev; depois, o teste de ponta a ponta com o Pmovel real.
- **Time Tracking** como destino: falta encontrar a API.
- **Cliente com folha mista** (parte no Workday Payroll, parte em folha de
  terceiro, como neste tenant): hoje o destino é por instância; precisaria ser por
  empresa.
- Enquanto a API Pmovel não tiver as rotas, a consulta registra erro 404 no log a
  cada rodada (deixe `PAYROLL_EXPORT_ENABLED=false`).
