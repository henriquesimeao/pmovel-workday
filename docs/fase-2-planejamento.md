# Fase 2: planejamento (Pmovel → Workday: horas extras e verbas)

> Documento de planejamento. Nada da Fase 2 foi implementado ainda. As seções 2 e 3
> são fatos verificados; a seção 4 registra as decisões; as seções 5 a 7 são a
> proposta. As rotas novas da API Pmovel estão em
> [fase-2-api-pmovel.md](fase-2-api-pmovel.md).

## 1. Objetivo

Levar ao Workday, por colaborador e período, as horas extras e demais verbas que o
Pmovel já apurou, para que entrem na folha. O colaborador é correlacionado pelo
mesmo `external_id` da Fase 1 (= `employeeID` do Workday).

## 2. Origem: `POST /v3/reports/event_totals` (Pmovel)

Lido no código de `pmovel_rest_api_nestjs` (`reports.service.ts`,
`summary_register_events.repository.ts`).

**Entrada:** `period` (`AAAAMM`, obrigatório), `cnpj` (14 dígitos, obrigatório),
`external_id[]` e `event_codes[]` (filtros opcionais).

**Saída:** por colaborador (`matricula`, `external_id`, `colaborador`), a lista de
`eventos`: `codigo_evento`, `descricao_evento`, `qtd_horas` (`HH:MM`),
`qtd_decimal` (horas decimais), `periodo`, `status_apuracao`
(`Fechada` / `Em apuração`), `competencia_inicio` e `competencia_fim`.

**Comportamento que importa para a integração:**

| Fato | Consequência |
|---|---|
| Uma chamada por **CNPJ** e por **período** | o job percorre as empresas de `cnpj_mapping` |
| Exige um **ciclo mensal** do cliente para o período; sem ele, responde 400 `No monthly cycle found` | período sem ciclo é "nada a enviar", não erro |
| A competência é a do ciclo (ex.: 15/05 a 14/06), não o mês civil | a data enviada ao Workday precisa ser definida (pergunta P6) |
| `status_apuracao` diz se o ciclo está fechado | enviar só ciclo `Fechada` (pergunta P4) |
| Soma `se_time` por colaborador e evento: **só totais**, sem detalhe por dia | o destino precisa aceitar total por período |
| Os códigos de evento são **por cliente** (`ev.e_client_id`) | o de/para evento → verba pode variar por empresa |
| **Só colaboradores ativos** (`u.e_active = true`) | **quem foi demitido na competência não aparece**, e as horas dele não seriam enviadas (pergunta P7) |

**Dados em dev:** as 4 empresas do integrador (`00111111000100` a `...0400`) **não têm
ciclo mensal** em 202609, 202610 nem 202611. Não há dado para testar a Fase 2 sem
criar ciclo e marcações no Pmovel de dev.

## 3. Destino: o que o Workday oferece

**Payroll Input (REST `payroll/v2/{tenant}/payrollInputs`).** É o lançamento de
horas, unidades ou valores numa verba (*pay component*) de um colaborador. A
documentação da Workday cita exatamente o caso de horas extras: escolher um pay
component de hora extra e informar as horas
([FAQ: Payroll Input](https://doc.workday.com/admin-guide/zh-tw/payroll/-11/wrv1511339197940.html)).
Regras relevantes:
- lançamento único (*one-time*) ou contínuo (*ongoing*); ambos exigem data de
  início, e o único entra no subperíodo que contém a data de fim
  ([Payroll Input](https://doc.workday.com/admin-guide/en-us/payroll/payroll-input/wrv1511339197940.html));
- o Workday não faz rateio pelas datas: lança o valor inteiro
  ([Add Payroll Input for Workers](https://doc.workday.com/admin-guide/en-us/payroll/payroll-input/pbj1548683434511.html)).

**No tenant de dev:** `payroll/v2/.../payrollInputs` e `payroll/v2/.../payGroups`
respondem **403 `S22` (permission denied)**: o recurso existe, falta permissão. A
especificação publicada lista `GET`/`POST /payrollInputs` e
`GET`/`PATCH`/`DELETE /payrollInputs/{ID}`
([perfil da API](https://apis.apievangelist.com/store/workday-integration-payroll-inputs-api/),
fonte de terceiros; confirmar no tenant). Os caminhos REST de Time Tracking
testados (`timeTracking/v1` e `v4`: `timeBlocks`, `timeEntries`,
`timeEntryCodes`) responderam 404.

**Ponto crítico: folha do Brasil.** O Payroll Input só tem efeito quando a folha
roda no **Workday Payroll**, que atende poucos países; o Brasil não está entre
eles. Folha brasileira com Workday costuma ser de um provedor externo (ADP e
outros), integrado pelos conectores de folha de terceiros (Payroll Interface /
PECI), que enviam ao provedor as mudanças cadastrais
([Workday Cloud Connect for Third-Party Payroll](https://workday.com/content/dam/web/en-us/documents/datasheets/datasheet-workday-cloud-connect-third-party-payroll.pdf)).
Nesse cenário, o destino certo das horas do Pmovel pode ser o provedor de folha, e
não o Workday. **Esta é a primeira pergunta a responder (P1).**

## 4. Decisões

| # | Tema | Decisão |
|---|---|---|
| P1 | A folha roda no Workday Payroll? | **Depende do cliente: em alguns sim, em outros não. Os dados vão para o Workday em todos os casos**, independente de onde a folha é processada (ver W1) |
| P2 | Como e quando enviar | **Uma vez por ciclo** (em geral, o mês), por **disparo manual do RH**. Todos os colaboradores, com as horas **somadas por verba** |
| P3 | O que enviar | **Todos os eventos de `summary_register_events` com `se_id_event > 0`.** Rotas novas na API Pmovel (ver [fase-2-api-pmovel.md](fase-2-api-pmovel.md)) |
| P4 | Ciclo e disparo | **Global: só ciclo fechado. Individual: ciclo aberto ou fechado** (A1). O RH dispara **dentro do sistema Pmovel** |
| P5 | Reenvio | **O ideal é apagar no Workday o que foi enviado antes e gravar de novo** (modo `replace`; ver W3 para quando não for possível apagar) |
| P6 | Datas | **Início e fim do ciclo do Pmovel.** O cliente define o ciclo de acordo com a folha |
| P7 | Demitidos na competência | **Envio individual**, disparado pelo RH. **Não entram no envio global**, para não duplicar |
| P8 | Verba sem correspondência | **Registrar a falha no log.** O cliente mantém os códigos iguais nos dois sistemas: o **`ehevents.e_code`** do Pmovel é o código da verba (pay component) no Workday. **Não há tabela de de/para** |
| W1 | Destino no Workday | **Configurável por integração, cobrindo todos os casos.** Cada instância do integrador atende um tenant; uma variável escolhe o destino: `payroll_input` (Payroll Input, para quem tem Workday Payroll) ou `time_tracking` (horas reportadas, para quem não tem). Ver seção 5 |
| W2 | Código da verba no Workday | **Igual ao `e_code` do Pmovel** (reference ID do pay component, ou do código de horas no Time Tracking) |
| W3 | O integrador pode apagar no Workday? | **Não se sabe; as duas possibilidades são suportadas.** Modo `replace` (apaga e grava de novo) e modo `delta` (lança só a diferença). Ver seção 5 |
| P9 | Reenvio quando o Workday recusa apagar (folha do período já processada) | **O item falha com a mensagem do Workday; o RH faz o ajuste no Workday e reenvia** |
| P10 | Moeda (obrigatória no Payroll Interface, mesmo para horas) | **Por empresa, coluna `currency` em `cnpj_mapping`**, versionada no seed |

## 5. Arquitetura

**Quem chama quem.** O integrador é o único que se comunica com os dois sistemas:
ele chama a API Pmovel (pedidos e totais) e chama o Workday (lançamentos). A API
Pmovel não fala com o Workday nem com o integrador; só responde.

**Disparo.** O RH cria no Pmovel uma solicitação de envio (global do ciclo, ou
individual de um demitido). O integrador consulta as solicitações pendentes a
cada N segundos, assume uma, processa e devolve o resultado, que o RH vê na tela
do Pmovel. O integrador não precisa ficar exposto na internet. Detalhes em
[fase-2-api-pmovel.md](fase-2-api-pmovel.md#1-fluxo).

**Configuração por integração** (uma instância por tenant Workday):

| Variável | Valores | Efeito |
|---|---|---|
| `PAYROLL_EXPORT_ENABLED` | `true` / `false` | liga a consulta de solicitações |
| `PAYROLL_EXPORT_POLL_SECONDS` | número | intervalo da consulta |
| `PAYROLL_EXPORT_DESTINATION` | `payroll_input` / `external_payroll_input` / `time_tracking` | onde as horas entram no Workday (W1) |
| `PAYROLL_EXPORT_RESEND_MODE` | `replace` / `delta` | como corrigir um envio anterior (W3) |

**Destinos (W1).** Os dois recebem a mesma entrada (colaborador, código da verba,
horas, início e fim do ciclo) e ficam atrás de uma mesma interface, então o job
não muda conforme o destino.

| Destino | Como grava | Granularidade |
|---|---|---|
| `payroll_input` | `POST payroll/v2/{tenant}/payrollInputs`: horas no pay component com o código da verba, datas do ciclo | **total do ciclo** por colaborador e verba |
| `external_payroll_input` | SOAP `Put_External_Payroll_Input` (serviço **Payroll_Interface**): lançamento para **folha de terceiro**. O Workday guarda e repassa ao provedor de folha pelo Payroll Interface | **total do ciclo** por colaborador e verba. Uma linha da mesma verba **não pode sobrepor datas** de outra; o reenvio atualiza a linha existente pela referência (a confirmar em E1) |
| `time_tracking` | horas reportadas num código de horas do Time Tracking, com o código da verba. **API a descobrir** (os caminhos REST testados responderam 404; pode ser SOAP) | **por dia**: o Time Tracking registra horas em datas. Exige da API Pmovel os totais por dia (`detail=daily` na rota de totais). Ver o risco na seção 8 |

**Modos de reenvio (W3).** O registro de envio guarda cada lançamento feito e o id
que o Workday devolveu.

| Modo | Reenvio do mesmo ciclo | Quando usar |
|---|---|---|
| `replace` | apaga no Workday os lançamentos anteriores (pelos ids guardados) e grava os novos. Se o Workday recusar apagar, o item falha com a mensagem (P9) | o usuário da integração pode apagar o que ele mesmo lançou |
| `delta` | compara com o que já foi lançado e grava **só a diferença** por colaborador e verba: positiva se aumentou, negativa se diminuiu, nada se igual. Verba que sumiu recebe o valor negativo do total anterior | o usuário da integração não pode apagar. **Requer que o Workday aceite valor negativo** (a confirmar em E1); se não aceitar, diferença negativa vira falha do item para ajuste manual |

**Job `payroll-events:export`**, uma execução (`sync_run`) por solicitação:

```
assume a solicitação (start)                         ← 409: outro já assumiu, ignora
lê os totais (totals, paginado; por dia no time_tracking)
monta o mapa external_id → worker do Workday (WQL, workdayID)
resolve código da verba → objeto do Workday          ← uma vez por código, em cache
modo replace: apaga o que o registro de envio tem para este ciclo e escopo
para cada colaborador × verba:                       ← 1 item de sync_item
  sem worker no Workday → falha do item
  sem verba com esse código no Workday → falha do item  ← P8
  replace: grava o total
  delta:   grava (total − já lançado), se diferente de zero
  guarda no registro de envio o id devolvido pelo Workday
devolve o resultado ao Pmovel (finish)
```

**Escopos e duplicidade (P7).** O registro de envio guarda o escopo de cada
lançamento:
- reenviar o **global** corrige só os lançamentos globais do ciclo;
- reenviar o **individual** corrige só os daquele colaborador no ciclo. O
  individual pode ser enviado com o ciclo **aberto** (A1) e reenviado quantas
  vezes for preciso;
- o integrador **recusa o individual** de quem já foi no global do mesmo ciclo
  (o caso de alguém demitido com data retroativa depois do envio global), com
  mensagem para o RH;
- num reenvio global, se alguém que estava no envio anterior não vem mais (foi
  demitido dentro do ciclo nesse meio-tempo), o integrador avisa no resultado: os
  lançamentos dele são corrigidos com o global e precisam do envio individual.

**Peças novas no integrador:**

| Peça | Para quê |
|---|---|
| `PmovelClient`: rotas de `payroll_exports` | listar, assumir, ler totais, devolver resultado |
| Interface de destino + `PayrollInputWriter` e `TimeTrackingWriter` | gravar e apagar lançamentos; achar a verba pelo código |
| Coluna **`currency`** em `cnpj_mapping` (migration + seed) | moeda do lançamento (P10) |
| Tabela **`payroll_input_sent`** (migration) | registro de envio: solicitação, ciclo, escopo, CNPJ, `employee_id` e `external_id`, código da verba, data (no `time_tracking`), segundos, id do lançamento no Workday, run. **É o que permite corrigir um envio anterior** nos dois modos: no Workday, lançar de novo soma |
| Consulta periódica das solicitações | `PAYROLL_EXPORT_POLL_SECONDS`, ligada por `PAYROLL_EXPORT_ENABLED` |
| Parâmetro de execução no orquestrador | hoje o job não recebe parâmetros; aqui ele recebe a solicitação |

**Reaproveitado da Fase 1:** orquestrador (lote, falha por item, lock por job,
recuperação de run presa), `BaseRestClient`, `sync_run`/`sync_item`.

**Tenant de dev (verificado em 25/11).** O tenant tem só **Payroll Interface**
(folha de terceiro), sem Workday Payroll: a REST `payroll/v2/payrollInputs`
responde 403, e o destino para este tenant é `external_payroll_input`.

Permissões liberadas ao grupo `ISSG_Pmovel`, na seção **Integration
Permissions** do domínio (a permissão de tela, View/Modify, não vale para web
service):
- **Worker Data: Payroll Interface (Payroll Input by Worker)**: Get e Put
  (lançamentos);
- **Payroll Interface**: Get (verbas, descontos, grupos de folha externos).

Os outros domínios que protegem essas operações, *Implementation* e *Special OX
Web Services*, dão acesso administrativo amplo e não foram liberados.

**Configuração de teste criada no tenant de dev (pela tela).** O Payroll Interface
estava vazio. Foram criados: calendário de períodos mensal, grupo de folha
externo `PMV Teste` (`PAY_GROUP-17-25`, **Canadá**: o Workday não permite grupo de
Payroll Interface para os EUA, porque a folha dos EUA deste tenant é do Workday
Payroll), o colaborador **21079** no grupo e a verba **`PMV_TESTE_HE`** (tipos de
entrada `INPUT`, `ADJ`, `GOAL`).

**Envio real validado (25/11)**, colaborador 21079, verba `PMV_TESTE_HE`, ciclo
15/05 a 14/06/2026, `Payroll_Input_ID = PMV-TESTE-21079-PMV_TESTE_HE`:

| Passo | Resultado |
|---|---|
| sem moeda | **recusado**: `Currency_Reference is required` |
| 1,5 h, moeda CAD | criado (1 lançamento) |
| mesmo id, 2 h | **atualizado no lugar** (mesmo WID, continua 1 lançamento) |
| mesmo id, 0 h | aceito; o lançamento fica com 0 h (estado final do teste) |

Não há operação SOAP para apagar lançamento no `Payroll_Interface`. O reenvio
corrige pelo `Payroll_Input_ID`, e verba que deixar de existir é **zerada**. Testado sem gravar:
`Get_External_Payroll_Inputs` responde (0 lançamentos) e um `Put` com dados
inexistentes chega à validação dos dados.

Contrato do `Put_External_Payroll_Input` (SOAP, `Payroll_Interface`, v45.0),
confirmado no tenant e na
[documentação da operação](https://community.workday.com/sites/default/files/file-hosting/productionapi/Payroll_Interface/v33.0/Put_External_Payroll_Input.html):

| Campo | Uso na integração |
|---|---|
| `Payroll_Input_ID` | **id definido pelo integrador**. Se já existir, o Workday atualiza; senão, cria. Reenvio idempotente sem apagar: `PMV-<ciclo>-<employee_id>-<verba>` |
| `Payee_Reference`, tipo `Employee_ID` | o `external_id` direto, **sem consultar o WID** |
| `Pay_Component_Workday_Reference`, tipo `Earning_Code` ou `Deduction_Code` | o `e_code` direto. O tipo vem do `e_type` do Pmovel: `P` (provento) → `Earning_Code`, `D` (desconto) → `Deduction_Code` |
| `Batch_ID` | um lote por solicitação, para o RH achar e, se preciso, apagar pela tela (*Delete Payroll Input by Batch ID*) |
| `Start_Date`, `End_Date` | início e fim do ciclo |
| `Unit` (+ `Unit_Type_Reference`) | horas decimais |
| `Currency_Reference` | **obrigatório, inclusive para horas** (confirmado no envio real). A mesma operação serve para valores em dinheiro, e o Workday exige a moeda sempre. Para horas, ela não muda nada. **Decisão: moeda por empresa, numa coluna nova `currency` em `cnpj_mapping`** (e no seed `seeds/cnpj-mapping/<ambiente>.json`). Dev: NLE USA e ASI → USD, NLE CAN → CAD, NLE UK → GBP |

Regras do Workday: não pode haver duas linhas não-ajuste da mesma verba com datas
sobrepostas, nem duas com a mesma verba e as mesmas datas. Com o `Payroll_Input_ID`
fixo por ciclo, colaborador e verba, o reenvio atualiza a linha e não esbarra
nessas regras (confirmado).

**A descobrir no Workday (E1):**
- como achar o pay component pelo código (a REST de Payroll Input referencia o
  pay component pelo id interno);
- se o Payroll Input aceita **valor negativo** (modo `delta`);
- se o usuário da integração consegue **apagar** o que lançou (modo `replace`);
- a API de horas reportadas do **Time Tracking** e se ela aceita registro por dia
  com código de horas;
- no `external_payroll_input`: **resolvido** (ver o envio real validado acima).

## 6. Pré-requisitos

**No Workday (tenant de dev, depois o do cliente):**
1. Domínio de **Payroll Input** no grupo de segurança da integração, com `Get` e
   `Put` (escrita), e leitura de pay components.
2. Escopo **Payroll** no API Client.
3. **Refresh token novo** depois de mudar o escopo (mesma lição do WQL: sem isso,
   `403 S22`).
4. Pay components com os **mesmos códigos** dos eventos do Pmovel (P8).

**No Pmovel:** as rotas novas e a tabela `payroll_exports`
([fase-2-api-pmovel.md](fase-2-api-pmovel.md)); em dev, um ciclo mensal fechado com
marcações e eventos em pelo menos uma das 4 empresas do integrador.

## 7. Etapas

| Etapa | Conteúdo | Quem | Depende de |
|---|---|---|---|
| E1 | Liberar permissões no tenant de dev; descobrir os pontos de "A descobrir no Workday" (seção 5) e o formato exato dos lançamentos nos dois destinos | admin Workday + integrador | |
| E2 | Rotas `payroll_exports` e tabela no Pmovel; dados de teste em dev | time Pmovel | |
| E3 | Integrador: clientes, migration `payroll_input_sent`, job, consulta periódica, parâmetro no orquestrador, testes. Pode começar com o contrato da API Pmovel simulado nos testes | integrador | E1 |
| E4 | Validar em dev, nos dois destinos e nos dois modos: envio global, reenvio, individual com ciclo aberto, individual recusado, verba inexistente, colaborador inexistente no Workday | todos | E2, E3 |
| E5 | Documentação | integrador | E4 |

## 8. Riscos

- **Destino `time_tracking` (W1):** o Time Tracking registra horas por dia e pode
  recalcular horas extras pelas regras do próprio Workday, divergindo do que o
  Pmovel apurou. Confirmar em E1 se dá para lançar horas já classificadas (código
  da verba) sem recálculo.
- **Modo `delta` sem valor negativo (W3):** se o Workday não aceitar, toda redução
  depois do envio vira ajuste manual.
- **Lançamento em dobro:** Payroll Input soma. O registro de envio é a única
  fonte para apagar o envio anterior; se ele se perder, o reenvio duplica.
- **Reenvio interrompido no meio:** parte apagada, parte gravada. O registro de
  envio é atualizado lançamento a lançamento, então disparar de novo termina o
  trabalho (apaga o que restou e grava tudo).
- **Período de folha já processado:** corrigir depois exige ajuste retroativo no
  Workday, que pode não ser aceito por API.
- **Demitido fora dos dois envios (P7):** se o RH não fizer o envio individual,
  as horas dele não vão. O resultado do envio global pode listar os demitidos do
  ciclo que ainda não tiveram envio individual.
- **Mesmo colaborador em dois cadastros** (readmissão, Fase 1): o `event_totals`
  agrupa por id interno do Pmovel e só traz ativos, então vem um só; ainda assim,
  validar quando houver dado.
