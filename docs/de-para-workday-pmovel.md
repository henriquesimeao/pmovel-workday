# De/para de campos — Workday → Pmovel (Fase 1)

Mapeamento dos campos do colaborador do **Workday** (origem) para o
`CreateEmployeeDto`/`UpdateEmployeeDto` do **Pmovel** (destino), na Fase 1.

> **Status:** validado contra o tenant de dev `wwglgmcdcl_extdev`. Com o domínio
> **WQL** liberado e o escopo **System** no API Client, os antigos gaps (datas de
> admissão/demissão, status, legal entity, CPF) **foram resolvidos** via WQL — ver
> a seção "Resolução via WQL" abaixo. Permanecem como decisão de negócio apenas os
> campos sem equivalente no Workday (`employeegroup_code`, `syndicate_code`,
> `workday_code`).
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

### Resolução via WQL

A REST "de recurso" do Workday não expõe datas de admissão/demissão, status,
legal entity nem national ID — confirmado por `403 S22` inicial e pela
documentação da comunidade (data de demissão/status exigem **WQL** ou **SOAP**;
ref.:
[StackOverflow](https://stackoverflow.com/questions/76569050/finding-things-like-termination-date-and-employment-status-in-the-workday-api),
parafraseado para conformidade de licenciamento).

**A solução adotada foi o WQL.** Após liberar o domínio **Workday Query Language
(WQL)** no `ISSG_Pmovel`, adicionar o escopo **System** no API Client e gerar um
novo refresh token (passo a passo em `docs/workday-novo-cliente.md`), uma única
query no data source **`allActiveAndTerminatedWorkers`** traz todos os campos:

```sql
SELECT employeeID, legalNameInGeneralDisplayFormat, primaryWork_Email,
       hireDate, terminationDate, currentlyActive, company_ID, company,
       dateOfBirth, isManager, jobCode, nationalIdentifiers
FROM allActiveAndTerminatedWorkers
```

Validado no tenant: 112 workers (82 ativos + 30 terminados), `hireDate` em 100%,
`company_ID` (legal entity) em 100%, `terminationDate` nos terminados.

## Tabela de de/para

Legenda de confiança: 🟢 alta (campo real encontrado) · 🟡 média (existe, precisa
confirmar/derivar) · 🔴 gap (não disponível na REST hoje / precisa decisão).

Campos WQL do data source `allActiveAndTerminatedWorkers`.

| Campo Pmovel | Obrig. | Origem Workday (WQL) | Conf. | Observação |
|---|:--:|---|:--:|---|
| `external_id` | ✔ | `employeeID` | 🟢 | **Decisão aplicada:** `employeeID` (ex.: `21001`), legível e estável. |
| `matricula` | ✔ | `employeeID` | 🟢 | Mesmo `employeeID`. |
| `name` | ✔ | `legalNameInGeneralDisplayFormat` | 🟢 | Nome legal formatado. |
| `cpf` | ✔ | `nationalIdentifiers` (número no `descriptor`) | 🟡 | CPF (`BRA-CPF`) só com dígitos; senão o documento principal. **Sem espaços**. `000000000` é recusado (a pessoa não é integrada). Ver a seção "CPF". |
| `email` | ✔ | `primaryWork_Email`; sem e-mail: `<documento>@<empresa>.com` | 🟢 | E-mail de trabalho quando existe. Sem ele, é gerado a partir do documento (campo `cpf`) e do nome da empresa. Ver a seção "E-mail gerado". |
| `cnpj` | ✔ | `company_ID` → de/para `cnpj_mapping` | 🟢 | `company_ID` é a legal entity legível (ex.: `NLE USA`). O CNPJ real sai do de/para que você popula. |
| `employeegroup_code` / `employeegroup_name` | ✔ | — (default) | 🔴 | Sem equivalente no Workday. Enviados **juntos** (`DEFAULT`/`DEFAULT`): com os dois o Pmovel cadastra o grupo sozinho. Só na admissão. |
| `syndicate_code` / `syndicate_name` | ✔ | — (default) | 🔴 | Idem. Enviados juntos; só na admissão. |
| `workday_code` / `workday_name` | ✔ | — (default) | 🔴 | Idem (jornada). Enviados juntos; só na admissão. |
| `dt_admissao` | ✔ | `hireDate` | 🟢 | Presente em 100% dos workers no tenant. |
| `dt_demissao` | — | `terminationDate` | 🟢 | Presente nos terminados (usado na demissão/`inactivate`). |
| `dt_nascimento` | — | `dateOfBirth` | 🟢 | PII — não logar valor. |
| `country` | ✔ | — (default `BR`) | 🟡 | Não incluído na query atual; default `BR`. Pode-se adicionar `primaryWork_Country` ao WQL se necessário. |
| `job_position` | — | `jobCode` | 🟡 | Código do cargo (ex.: `Analista_Sistemas`). Se preferir o título legível, adicionar `businessTitle`/`jobProfile` à query. |
| `is_manager` | ✔ | `isManager` | 🟢 | Booleano. |
| `is_hr_manager` | — | — | 🔴 | Sem equivalente. Default `false`. |
| `home_office` | — | — | 🔴 | Sem equivalente. Default `false`. |
| `manager_external_id` | — | gestor (`manager_Level01` etc. no WQL) | 🟡 | Disponível no WQL; mapear para o `employeeID` do gestor. Pode ficar para um segundo momento. |
| `rg` / `pis` | — | national IDs (BR) | 🟡 | Via `nationalIdentifiers` quando o tenant for BR (múltiplos tipos de ID). |

## Decisões aplicadas

1. **Chave `external_id` = `employeeID`** (legível e estável). `matricula` idem.
2. **Datas/status/legal entity/CPF via WQL** — resolvido (ver "Resolução via WQL").
   O `WorkdayClient.listConsolidatedWorkersViaWql()` já traz tudo numa query.
3. **CNPJ** resolvido por `company_ID` (legal entity) → tabela `cnpj_mapping`, que
   você popula por cliente.

## Regra: uma empresa do Workday = um cliente no Pmovel

Cada empresa (legal entity) do Workday precisa existir como **cliente no Pmovel**,
com **CNPJ próprio**, e ter um registro em `cnpj_mapping`. Não se reaproveita um
CNPJ para várias empresas.

Consequência: workers de uma empresa **sem de/para** não são criados. O item
falha e o lote continua. A mensagem em `sync_item.errorMessage` informa qual
empresa falta cadastrar, por exemplo:

```
Worker 21001: campos obrigatórios ausentes: cnpj (empresa "NLE CAN" sem de/para em cnpj_mapping)
```

Para liberar uma nova empresa: cadastre-a como cliente no Pmovel e insira o par
(`legalEntityId`, `cnpj`) em `cnpj_mapping`. O CNPJ vai só com números.

Situação no tenant de dev (workers vistos no Workday). Os clientes abaixo existem
no Pmovel de desenvolvimento (cliente `workday`):

| Empresa no Workday | Chave em `cnpj_mapping` | CNPJ (Pmovel) | Workers | Ativos |
|---|---|---|---:|---:|
| Next Level Enterprises (USA) | `NLE USA` | `00111111000100` | 66 | 36 |
| Next Level Enterprises, Ltd (Canada) | `NLE CAN` | `00111111000200` | 15 | 15 |
| Next Level Enterprises, PLC (UK) | `9dff7a68…` (sem `company_ID`, usa o id interno) | `00111111000300` | 28 | 28 |
| Advanced Solutions, Inc. (USA) | `ASI` | `00111111000400` | 3 | 3 |

Resultado real no tenant de dev (execução 4 contra a API do Pmovel): nenhuma falha
por CNPJ. Dos 82 ativos, 75 foram criados/atualizados. Os 30 demitidos nunca
existiram no Pmovel e foram ignorados (se existissem e estivessem ativos, seriam
inativados). Ver `fase-1-colaboradores.md` para as 7 falhas e suas causas.

> O de/para fica na tabela `cnpj_mapping` do banco, não no git. Em outro ambiente
> (homologação, produção), insira os pares com os CNPJs daquele ambiente.

## CPF: documento principal para quem não é brasileiro

O campo `cpf` do Pmovel recebe:

1. o **CPF** (`BRA-CPF`), só com dígitos, quando a pessoa tem;
2. senão, o **documento principal** dela (o primeiro da lista de
   `nationalIdentifiers`), do jeito que o Workday formata, **sem espaços**;
3. sem nenhum documento, o item falha e é registrado. Quem está nesse caso precisa
   ter o documento cadastrado no Workday.

Regras do campo, aplicadas na criação **e** na atualização
(`EmployeeMapper`):

- **Sem espaços**: `AB 12 34 56 C` vai como `AB123456C`, `123 456 789` como
  `123456789`. Hífens são mantidos (`123-45-6789`). Letras do NINO britânico também.
- **Documento recusado**: `000000000` (valor de preenchimento que já existe no
  Pmovel e causa conflito). A comparação ignora espaços, pontuação e caixa, então
  `000 000 000` e `000-00-0000` também são recusados. Quem tem esse documento
  **não é integrado**: o item falha com `documento inválido`, mesmo se tiver e-mail
  real, e o e-mail gerado não é montado a partir dele. A lista fica em
  `invalidDocuments`, em `src/mapping/mapping.config.ts`.
- Demissão não depende do documento: um demitido com documento recusado ainda é
  inativado se existir no Pmovel.

Cada documento vem como `{id, descriptor}`. O número está no `descriptor`
(`"123-45-6789 (USA-SSN)"`); o `id` é um código interno e nunca é usado.

No tenant de dev, 34 dos 112 workers não têm documento nenhum
(`hasNationalIdentifier = false`) e 78 têm: 37 `USA-SSN`, 13 `CAN-SIN` e
28 `GBR-NINO`. Um dos `CAN-SIN` é `000 000 000` e é recusado.

> A API do Pmovel aceitou documento estrangeiro no campo `cpf` (confirmado na
> gravação de teste).

## E-mail gerado

O e-mail é obrigatório no Pmovel. Quem não tem e-mail de trabalho no Workday recebe
`<documento>@<empresa>.com`:

- **documento**: o mesmo valor enviado no campo `cpf`;
- **empresa**: nome legível da empresa no Workday (`company.descriptor`);
- ambos em minúsculas, sem acentos e só com letras e números (espaços,
  hífens, vírgulas e parênteses são removidos).

| Documento | Empresa | E-mail gerado |
|---|---|---|
| `123-45-6789` | Next Level Enterprises (USA) | `123456789@nextlevelenterprisesusa.com` |
| `AB 12 34 56 C` | Next Level Enterprises, PLC (UK) | `ab123456c@nextlevelenterprisesplcuk.com` |

Sem documento (ou sem nome da empresa) o e-mail não é gerado e o item falha por
campo ausente.

**Na atualização o e-mail gerado não é reenviado**, para não sobrescrever um
e-mail que alguém tenha corrigido à mão no Pmovel. O e-mail real do Workday, esse
sim, é enviado normalmente.

O e-mail gerado usa o documento já sem espaços. Pessoa com documento recusado
não recebe e-mail gerado.

## Decisões de negócio ainda abertas

Apenas os campos **sem equivalente no Workday** (todos obrigatórios no Pmovel),
hoje com `default: 'DEFAULT'` (code e name) em `src/mapping/mapping.config.ts`:

- `employeegroup_*`, `syndicate_*`, `workday_*`.

Decisão do usuário até aqui: **manter `DEFAULT`**. Para produção, confirmar se haverá
de/para por alguma dimensão do Workday.

**Regra aplicada:** esses três campos são definidos **apenas na admissão** (com
`default: 'DEFAULT'`) e **nunca enviados na atualização** — podem ter sido
ajustados manualmente no Pmovel, e o integrador não deve sobrescrevê-los. Isso é
controlado por `immutableOnUpdate` em `src/mapping/mapping.config.ts`.

Se quiser trocar o valor fixo ou derivar de uma dimensão do Workday (localização,
workerType, organização), é só ajustar a config — a camada de mapeamento suporta
os três modos (direct/lookup/default) sem mexer em código.

A tabela `cnpj_mapping` do ambiente de dev já está populada com as 4 empresas. Em
homologação e produção ela precisa ser populada com os CNPJs reais de cada cliente.
