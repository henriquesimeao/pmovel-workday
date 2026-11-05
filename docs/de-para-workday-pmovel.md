# De/para de campos — Workday → Pmovel (Fase 1)

Mapeamento dos campos do colaborador do **Workday** (origem) para o
`CreateEmployeeDto`/`UpdateEmployeeDto` do **Pmovel** (destino), na Fase 1.

> **Status:** proposta inicial, baseada em **descoberta real** contra o tenant de
> dev `wwglgmcdcl_extdev` (Workday). Alguns campos são **gaps** que dependem de
> decisão sua e/ou de liberação de permissão no Workday — marcados abaixo.
>
> **PII:** este documento registra apenas **nomes/caminhos de campos**. Nenhum
> valor real de CPF, nascimento ou nome de pessoa é versionado. As capturas cruas
> ficam em `discovery-output/` (ignorado pelo git).

## Como a descoberta foi feita

Explorando a REST API do Workday com o `WorkdayClient`:

- `common/v1/{tenant}/workers/{id}` — forma base do worker.
- `staffing/v6/{tenant}/workers/{id}` — dados de cargo, organização, país, pessoa.
- `person/v4/{tenant}/people/{id}/...` — dados pessoais (sub-recursos HATEOAS).
- `wql/v1/{tenant}/data` — tentado para datas de emprego/legal entity/national ID.

### Achado importante: limites da REST API

Vários campos sensíveis de RH **não são expostos diretamente pela REST API** do
Workday neste tenant. Confirmado por:

1. **403 `permission denied` (S22)** no endpoint **WQL** (`wql/v1/.../data` e
   `/dataSources`) — mesmo padrão descrito em `docs/workday-novo-cliente.md`
   (domínio sem permissão / escopo não liberado para o ISU).
2. Documentação da comunidade indica que **data de demissão e status de emprego**
   não vêm pela REST "de recurso" — é preciso **WQL** (consultando um data source)
   ou a **SOAP API**. Ref.:
   [StackOverflow](https://stackoverflow.com/questions/76569050/finding-things-like-termination-date-and-employment-status-in-the-workday-api)
   (conteúdo parafraseado para conformidade de licenciamento).

**Consequência:** para a Fase 1 completa (admissão/atualização/**demissão**),
precisaremos de **datas de admissão/demissão** e **status ativo/terminado**, que
hoje estão num gap. As opções estão na seção "Decisões pendentes".

## Tabela de de/para

Legenda de confiança: 🟢 alta (campo real encontrado) · 🟡 média (existe, precisa
confirmar/derivar) · 🔴 gap (não disponível na REST hoje / precisa decisão).

| Campo Pmovel | Obrig. | Origem Workday sugerida | Conf. | Observação |
|---|:--:|---|:--:|---|
| `external_id` | ✔ | `staffing/v6 → workerId` (ou `worker.id`) | 🟡 | **Decisão:** qual identificador vira a chave. `workerId` (ex.: `21142`) é legível e estável; `id` é o WID técnico. Sugiro `workerId`. |
| `matricula` | ✔ | `staffing/v6 → workerId` | 🟢 | Mesmo `workerId`. Se `external_id` usar o WID, `matricula` fica com `workerId`. |
| `name` | ✔ | `worker.descriptor` ou `person legalName` | 🟡 | `descriptor` traz o nome de exibição. Nome legal estruturado (`legalName`) é sub-recurso person — a confirmar. |
| `cpf` | ✔ | national ID (via WQL/SOAP) | 🔴 | **Gap**: national IDs não expostos na REST (403 no WQL). Tenant de demo é dos EUA (SSN), não CPF. Ver decisões. |
| `email` | ✔ | `staffing/v6 → person.email` | 🟢 | E-mail de trabalho disponível diretamente. |
| `cnpj` | ✔ | legal entity/company → de/para manual | 🔴 | **Gap**: company/legal entity não veio na REST. Resolver via de/para `cnpj_mapping` (legal entity Workday ↔ CNPJ Pmovel). Falta identificar o campo da legal entity (provável via WQL/SOAP ou outro endpoint de organização). |
| `employeegroup_code` | ✔ | — | 🔴 | **Gap**: não há equivalente direto. Candidato: `workerType` (`Employee`/`Contingent`) ou organização. Precisa de de/para ou default. |
| `syndicate_code` | ✔ | — | 🔴 | **Gap**: sindicato é conceito da folha BR, inexistente no tenant de demo. Precisa de de/para (por localização/categoria) ou default. |
| `workday_code` | ✔ | — | 🔴 | **Gap**: "jornada"/escala de trabalho do Pmovel. Não há equivalente óbvio no worker. Candidato: derivar de posição/horário (Position's Work Schedule) — precisa investigar/decisão. Default provável. |
| `dt_admissao` | ✔ | hire date (via WQL/SOAP) | 🔴 | **Gap**: data de admissão não exposta na REST de recurso. Necessária para admissão. Ver decisões. |
| `dt_demissao` | — | termination date (via WQL/SOAP) | 🔴 | **Gap**: data de demissão não exposta na REST. Necessária para a demissão (`inactivate`). Ver decisões. |
| `dt_nascimento` | — | `common/v1 → dateOfBirth` ou `person personalInformation → dateOfBirth` | 🟢 | Disponível (PII — não logar valor). |
| `country` | ✔ | `staffing/v6 → primaryJob.location.country.ISO_3166-1_Alpha-2_Code` | 🟡 | A REST trouxe `ISO_3166-1_Alpha-3_Code` (ex.: `USA`). O Pmovel quer **2 letras** (`BR`). Converter Alpha-3 → Alpha-2 (tabela) ou buscar o Alpha-2 no payload (apareceu em person). |
| `job_position` | — | `staffing/v6 → primaryJob.descriptor` | 🟡 | Vem como "Cargo - Nome da pessoa". Pode precisar limpar para só o cargo. |
| `is_manager` | ✔ | `common/v1 → isManager` | 🟢 | Booleano direto. |
| `is_hr_manager` | — | — | 🔴 | Sem equivalente direto. Default `false` ou de/para por papel. |
| `home_office` | — | — | 🔴 | Sem equivalente. Default `false`. |
| `manager_external_id` | — | gestor via `primarySupervisoryOrganization` → manager | 🟡 | Precisa resolver o gestor da org e mapear para o `workerId` dele. Pode ficar para um segundo momento. |
| `job_level` / `job_family` / `job_family_sub` / `job_family_description` | — | job profile / compensation grade | 🟡 | Opcionais. Candidatos em job profile (não capturados ainda). Deixar vazio inicialmente. |
| `gmt` | — | derivar da localização/país | 🟡 | Opcional. Default por país (ex.: BR = -3). |
| `social_name` / `preferred_name` | — | `person preferredName` | 🟡 | Sub-recurso person. Opcional. |
| `rg` / `pis` | — | national IDs (BR) | 🔴 | Gap (idem CPF). Conceitos BR, ausentes no tenant de demo. |

## Campos disponíveis com alta confiança (resumo)

Confirmados no tenant real e prontos para mapeamento direto:

- `person.email` → `email`
- `workerId` → `matricula` (e candidato a `external_id`)
- `isManager` → `is_manager`
- `dateOfBirth` → `dt_nascimento`
- `primaryJob.descriptor` → `job_position` (com limpeza)
- `primaryJob.location.country.*` → `country` (com conversão Alpha-3 → Alpha-2)
- `worker.descriptor` → `name`

## Decisões pendentes (preciso da sua ajuda)

1. **Chave `external_id`**: usar `workerId` (legível, ex.: `21142`) ou o `id`/WID
   técnico do Workday? _Sugestão: `workerId`._

2. **Datas de admissão/demissão e status (ativo/terminado)** — 🔴 **bloqueante para
   a demissão e para a classificação da Fase 1.** Não vêm pela REST de recurso.
   Opções:
   - **(a)** Liberar o domínio do **WQL** para o ISU no Workday (seguindo o padrão
     do `docs/workday-novo-cliente.md`: adicionar permissão + Activate Pending
     Security Policy Changes). Aí consigo `hireDate`, `terminationDate`, `active`,
     `company`, national IDs numa única query. _Recomendado._
   - **(b)** Usar a **SOAP API** (`Get_Workers`) só para esses campos.
   - **(c)** Escopo reduzido inicial: sincronizar só dados cadastrais (sem demissão),
     e tratar admissão/demissão numa etapa seguinte.
   Qual caminho?

3. **CNPJ ↔ legal entity**: preciso identificar o campo da **legal entity/company**
   do worker. Ele deve vir junto com a liberação do WQL (decisão 2). Depois você
   popula a tabela `cnpj_mapping` (legal entity → CNPJ). Confirma essa abordagem?

4. **`employeegroup_code`, `syndicate_code`, `workday_code`** (todos obrigatórios no
   Pmovel, sem equivalente no Workday): como preencher?
   - de/para por alguma dimensão do Workday (ex.: localização, workerType, org)? ou
   - **valor default** configurável por tenant (ex.: um grupo/sindicato/jornada
     padrão) enquanto não houver dimensão correspondente?
   _Sugestão: começar com default configurável e evoluir para de/para quando você
   indicar a dimensão de origem._

## Próximos passos

- A **camada de mapeamento** (Task 7) já será construída para suportar os três
  modos (direto / de-para por tabela / default), então os gaps acima viram
  **configuração**, não código. Os campos 🟢/🟡 já entram como mapeamento direto.
- Assim que você decidir os itens acima (especialmente o 2), eu:
  - ajusto o `WorkdayClient` para buscar os campos via WQL (ou SOAP), e
  - preencho a `mapping.config` e a tabela `cnpj_mapping`.
