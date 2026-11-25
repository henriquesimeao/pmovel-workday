# Fase 2: rotas novas na API Pmovel

> Especificação para o time da API Pmovel (`pmovel_rest_api_nestjs`). Descreve o
> que o integrador Workday precisa para enviar as verbas do ciclo à folha. Segue
> as convenções da API v3: autenticação por `POST /v3/auth/login` (JWT), escopo
> pelos clientes da credencial, nomes em `snake_case` e erros no formato
> `{ message: string[], error, status_code }`.
>
> Contexto e decisões: [fase-2-planejamento.md](fase-2-planejamento.md).

## 1. Fluxo

**A API Pmovel não se comunica com o Workday nem chama o integrador.** Ela só
responde: grava o pedido do RH, entrega os totais quando o integrador pede e
guarda o resultado que ele devolve. Todas as chamadas partem do **integrador**,
que busca os dados na API Pmovel e grava no Workday.

```
RH (sistema Pmovel)                API Pmovel                       Integrador Workday
────────────────────               ─────────────                    ──────────────────
1. escolhe o ciclo fechado ──────► POST /payroll_exports
   (ou o demitido, envio            cria a solicitação "pending"
   individual)
                                                      ◄──────────── 2. GET /payroll_exports?status=pending
                                                                       (consulta a cada N segundos)
                                   POST /{id}/start   ◄──────────── 3. assume a solicitação
                                   "pending" → "processing"            (409 se outro já assumiu)
                                   GET  /{id}/totals  ◄──────────── 4. lê os totais por colaborador e verba
                                                                    5. apaga o envio anterior no Workday e grava
                                   POST /{id}/finish  ◄──────────── 6. devolve o resultado e os erros
4. RH vê o status e os erros ◄──── GET /payroll_exports/{id}
```

**Por que o integrador consulta o Pmovel, e não o contrário.** O disparo nasce no
Pmovel, mas quem chama é o integrador. Assim ele não precisa ficar exposto na
internet, nem o Pmovel precisa saber o endereço de cada integrador. A
solicitação também guarda o resultado, então o RH acompanha tudo pela própria
tela do Pmovel. O custo é um atraso de até N segundos (configurável no
integrador) entre o clique e o início do envio.

## 2. Tabela nova: `payroll_exports`

Uma linha por solicitação de envio.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | int PK | |
| `client_id` | int | cliente do ciclo |
| `cycle_id` | int | ciclo (`cycles.id`) |
| `scope` | enum `global`, `individual` | envio do ciclo inteiro ou de um demitido |
| `employee_id` | int, null | colaborador (`users.id`), só no `individual` |
| `target` | varchar | qual integrador deve pegar o pedido, ex.: `workday`. Só filtra a listagem: o Pmovel não envia nada a esse sistema |
| `status` | enum `pending`, `processing`, `completed`, `completed_with_errors`, `failed`, `canceled` | |
| `requested_by` | int | usuário do RH que disparou |
| `requested_at`, `started_at`, `finished_at` | timestamp | |
| `summary` | json, null | contadores devolvidos pelo integrador |
| `errors` | json, null | lista de erros por colaborador/verba (formato na rota `finish`) |
| `error_message` | text, null | erro geral, quando o envio inteiro falha |
| `outdated` | bool, padrão `false` | o envio ficou desatualizado (ver 3.7) |
| `outdated_at` | timestamp, null | quando ficou desatualizado |

## 3. Rotas

### 3.1 `POST /v3/payroll_exports`: criar a solicitação (usada pela tela do RH)

```json
{ "cycle_id": 456, "scope": "global", "target": "workday" }
{ "cycle_id": 456, "scope": "individual", "external_id": "21411", "target": "workday" }
```

Validações (400 com mensagem clara):
- o ciclo existe, é do escopo da credencial, não está removido e é **mensal**
  (`week IS NULL`);
- `global`: o ciclo está **fechado** (`closed_cycle = 1`);
- `individual`: o colaborador existe no cliente do ciclo e tem `dt_demissao`
  **dentro do ciclo** (entre `start_date` e `end_date`). O ciclo pode estar
  **aberto ou fechado** (a rescisão costuma ser paga antes do fechamento). Pode
  ser reenviado: cada envio substitui o anterior daquele colaborador;
- não há outra solicitação `pending` ou `processing` para o mesmo ciclo (409).
  Para o `individual`, a regra vale para o mesmo ciclo + colaborador.

Resposta 201: a solicitação (mesmo formato da 3.2).

### 3.2 `GET /v3/payroll_exports` e `GET /v3/payroll_exports/{id}`

Filtros da listagem: `status`, `target`, `cycle_id`, `page`, `limit`. O integrador
usa `?status=pending&target=workday`. A ordem é por `requested_at` crescente. **Sem resultados,
responde `200` com `[]`** (não 404: o integrador trata 404 como rota inexistente).

```json
{
  "id": 123,
  "cnpj": "00111111000100",
  "cycle": { "id": 456, "year": "2026", "month": "06",
             "start_date": "2026-05-15", "end_date": "2026-06-14", "closed": true },
  "scope": "global",
  "external_id": null,
  "target": "workday",
  "status": "pending",
  "requested_by": "nome do usuário",
  "requested_at": "2026-06-20T13:00:00Z",
  "started_at": null, "finished_at": null,
  "summary": null, "errors": null, "error_message": null,
  "outdated": false, "outdated_at": null
}
```

### 3.3 `POST /v3/payroll_exports/{id}/start`: assumir a solicitação

Muda `pending` → `processing` e grava `started_at`, **de forma atômica**
(`UPDATE ... WHERE id = ? AND status = 'pending'`). Se a solicitação não estiver
`pending`, responde 409. Resposta 200: a solicitação.

### 3.4 `GET /v3/payroll_exports/{id}/totals`: totais do ciclo

Só para solicitações `processing` (senão 409). Devolve os totais de
`summary_register_events` do cliente, no intervalo do ciclo
(`se_date BETWEEN start_date AND end_date`), com `se_id_event > 0`, **somados por
colaborador e por código de verba** (`ehevents.e_code`).

- **Todos os eventos entram**, inclusive os que foram desativados ou removidos
  depois da apuração (sem filtro por `ev.e_active` / `ev.e_removed`). O filtro do
  evento é só o cliente (`ev.e_client_id`).
- O total é a soma de `se_time`, **sem aplicar** `se_factor` / `se_factor_time`.

Parâmetros: `page`, `limit` (padrão 100, por colaborador) e `detail`:
- `detail=total` (padrão): um total por colaborador e verba no ciclo;
- `detail=daily`: o total por colaborador, verba **e dia** (`se_date`). Usado
  quando o destino no Workday é o Time Tracking, que registra horas por data.

Quem entra:
- `global`: colaboradores do cliente **sem demissão dentro do ciclo**, ativos ou
  não. Quem tem `dt_demissao` entre `start_date` e `end_date` fica de fora: vai no
  envio individual. Quem foi demitido depois do fim do ciclo trabalhou o ciclo
  inteiro e entra;
- `individual`: só o colaborador da solicitação.

Diferenças em relação ao `event_totals` atual, que é a base:

| `event_totals` hoje | `totals` novo | Motivo |
|---|---|---|
| só `u.e_active = true` | inclui inativos, com a regra acima | horas de demitidos e de quem saiu depois do ciclo não podem sumir |
| agrupa por `ev.id` | agrupa por `ev.e_code` | a verba é o código; dois eventos com o mesmo código somam |
| procura o ciclo por `year`/`month` | usa o ciclo da solicitação | o ciclo é escolhido pelo RH |
| só eventos ativos (`ev.e_active`, `ev.e_removed`) | todos os eventos do cliente | todos os eventos que existirem devem ir |
| só o total do ciclo | total do ciclo ou por dia (`detail`) | destino Time Tracking |
| sem paginação | paginado por colaborador (`page`, `limit`, padrão 100) | clientes grandes |

Resposta 200:

```json
{
  "export_id": 123,
  "scope": "global",
  "cnpj": "00111111000100",
  "cycle": { "id": 456, "start_date": "2026-05-15", "end_date": "2026-06-14",
             "closed": true, "closed_at": "2026-06-16T18:00:00Z" },
  "page": 1, "limit": 100, "total_employees": 230,
  "employees": [
    {
      "employee_id": 282539,
      "external_id": "21411",
      "matricula": "21411",
      "name": "NOME DO COLABORADOR",
      "active": true,
      "dt_demissao": null,
      "events": [
        { "code": "0020", "name": "Horas Extras 50%", "type": "P",
          "total_seconds": 12600, "hours_decimal": 3.5, "hours": "03:30" },
        { "code": "0300", "name": "Faltas", "type": "D",
          "total_seconds": 28800, "hours_decimal": 8.0, "hours": "08:00" }
      ]
    }
  ]
}
```

Com `detail=daily`, cada evento traz a lista por dia:

```json
{ "code": "0020", "name": "Horas Extras 50%", "type": "P",
  "total_seconds": 12600, "hours_decimal": 3.5, "hours": "03:30",
  "days": [
    { "date": "2026-05-18", "total_seconds": 5400, "hours_decimal": 1.5, "hours": "01:30" },
    { "date": "2026-05-20", "total_seconds": 7200, "hours_decimal": 2.0, "hours": "02:00" }
  ] }
```

Observações:
- `total_seconds` é o valor de referência (exato). `hours_decimal` e `hours` são
  conveniências.
- `employee_id` (id interno do Pmovel) é necessário porque uma pessoa readmitida
  tem dois cadastros com o mesmo `external_id` (ver Fase 1, readmissão).
- Colaborador sem nenhum evento no ciclo não aparece.

### 3.5 `POST /v3/payroll_exports/{id}/finish`: devolver o resultado

Só para `processing` (senão 409). Grava `status`, `finished_at`, `summary`,
`errors` e `error_message`.

```json
{
  "status": "completed_with_errors",
  "summary": { "employees": 230, "inputs_sent": 410, "inputs_zeroed": 3,
               "failures": 2,
               "warnings": ["colaborador 21500 estava no envio global anterior e não veio neste (demitido no ciclo?): os lançamentos dele foram zerados; faça o envio individual"] },
  "errors": [
    { "external_id": "21609", "code": "0020",
      "message": "verba 0020 não existe no Workday" },
    { "external_id": "21047", "code": null,
      "message": "colaborador não encontrado no Workday" }
  ],
  "error_message": null
}
```

`status`: `completed` (sem erros), `completed_with_errors` (parte não foi enviada)
ou `failed` (nada foi enviado; `error_message` diz por quê).

### 3.6 (Opcional) `POST /v3/payroll_exports/{id}/cancel`

`pending` → `canceled`, para o RH desistir antes de o integrador assumir.

### 3.7 Envio desatualizado (regra interna do Pmovel, sem rota nova)

Quando um ciclo é **reaberto** (`closed_cycle` 1 → 0) depois de um envio, o Pmovel
marca `outdated = true` e grava `outdated_at` nas solicitações `completed` e
`completed_with_errors` daquele ciclo. A tela do RH mostra o aviso, e o RH dispara
um novo envio quando o ciclo for fechado de novo. Um novo envio do mesmo ciclo e
escopo não precisa desmarcar o antigo: o envio vigente é sempre o mais recente.

Envios **individuais** podem ter sido feitos com o ciclo aberto, então as horas
do colaborador podem mudar depois. Sugestão: marcar `outdated` também quando o
resumo (`summary_register_events`) daquele colaborador no ciclo for recalculado
depois do envio individual.

## 4. Permissões

- A credencial do integrador (`users_api_client`) precisa de acesso às rotas 3.2
  a 3.5.
- A rota 3.1 é da tela do RH (usuário logado), não do integrador.

## 5. Decisões já tomadas (referência)

| # | Pergunta | Decisão |
|---|---|---|
| A1 | O envio individual do demitido exige ciclo fechado? | **Não** |
| A2 | Aplicar `se_factor` / `se_factor_time` ao total? | **Não** |
| A3 | Eventos desativados ou removidos depois da apuração vão? | **Sim, todos os eventos que existirem** |
| A4 | `severance_process_number` tem relação com o envio? | **Não se aplica**: campo ignorado na Fase 2 |
| A5 | Ciclo reaberto depois do envio: marcar como desatualizado? | **Sim** (ver 3.7) |
