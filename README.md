# Integração Pmovel ↔ Workday

Aplicação integradora em **NestJS + TypeScript** que sincroniza dados entre o
**Workday** e o **Pmovel** via REST API, em fases.

- **Fase 1** (implementada e validada em dev, com pendências): colaboradores —
  admissões, atualizações e demissões, no sentido **Workday → Pmovel**.
- **Fases 2–4** (roadmap): horas extras/verbas de folha, férias e afastamentos.

> **Retomando o projeto? Comece por [docs/continuidade.md](docs/continuidade.md):**
> estado atual, como subir o ambiente, decisões, armadilhas e o que falta.

Arquitetura e decisões de projeto: [docs/arquitetura.md](docs/arquitetura.md).

## Requisitos

- Node.js **20.6+** (desenvolvido/testado em Node 25)
- MySQL com um database vazio para o integrador (estado das sincronizações, de/para
  de CNPJ, cursores)
- API do Pmovel acessível (em dev: `http://127.0.0.1:3000`)
- Arquivo `.env` preenchido (modelo em [.env.example](.env.example))

## Setup

```bash
npm install
cp .env.example .env     # preencha: Workday, Pmovel e MySQL
npm run migration:run    # cria as tabelas no MySQL
npm run start:dev        # compila, sobe e recarrega ao salvar; lê o .env
```

Sem recarga automática: `npm run start`. Em produção, `npm run build` e
`npm run start:prod` (lê as variáveis do ambiente do processo, não do `.env`).

Valide com o health check (a aplicação usa a porta **3001**, porque a 3000 é da
API do Pmovel em dev):

```bash
curl http://127.0.0.1:3001/health
# { "status": "ok", "timestamp": "..." }
```

A aplicação **recusa subir** se o `.env` estiver incompleto — a validação de
ambiente é feita no boot (ver [docs/arquitetura.md](docs/arquitetura.md)).

## Scripts

| Comando | O que faz |
|---|---|
| `npm run start:dev` | Sobe a aplicação em watch mode |
| `npm run build` | Compila para `dist/` |
| `npm test` | Testes unitários (Jest) |
| `npm run test:e2e` | Testes end-to-end |
| `npm run lint` | ESLint + Prettier |
| `npm run migration:run` | Aplica as migrations do banco (MySQL) |
| `npm run ref:test:connection` | **Referência**: testa a conexão com o Workday (código JS original) |
| `npm run ref:workers:list` | **Referência**: lista workers do Workday (código JS original) |

## Operação da sincronização

A Fase 1 (colaboradores, Workday → Pmovel) está disponível. Detalhes em
[docs/fase-1-colaboradores.md](docs/fase-1-colaboradores.md).

Disparo **sob demanda**:

```bash
# inicia uma sincronização
curl -X POST http://127.0.0.1:3001/sync/employees/full
# { "runId": 1, "phase": "employees", "type": "full" }

# consulta o resultado (status, contadores, itens com sucesso/falha)
curl http://127.0.0.1:3001/sync/runs/1

# lista os jobs registrados
curl http://127.0.0.1:3001/sync/jobs
```

Disparo **agendado**: no `.env`, defina `SYNC_SCHEDULE_ENABLED=true` e o
`SYNC_CRON` (ex.: `0 * * * *` para de hora em hora).

### Configuração do mapeamento

- **Campos Workday → Pmovel**: `src/mapping/mapping.config.ts`
  (`DEFAULT_EMPLOYEE_MAPPING`). Modos: direto, de-para por tabela, ou default fixo.
  Base e decisões pendentes em [docs/de-para-workday-pmovel.md](docs/de-para-workday-pmovel.md).
- **CNPJ ↔ legal entity**: tabela `cnpj_mapping` (populada pela operação; não está
  no git). Cada empresa do Workday precisa ser um cliente no Pmovel com CNPJ próprio.

### Itens que precisam de alguém

Falhas esperadas ficam em `sync_item` e no log. As de **TRATAMENTO MANUAL** (e-mail
ou CPF já usado por outra pessoa no Pmovel) são listadas, com os valores em destaque,
no fim de cada execução. Consultas prontas em
[docs/continuidade.md](docs/continuidade.md#11-consultas-úteis-mysql-do-integrador).

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/continuidade.md](docs/continuidade.md) | **Comece aqui**: estado atual, como retomar, decisões, armadilhas, pendências |
| [docs/arquitetura.md](docs/arquitetura.md) | Arquitetura, fases, decisões de projeto, status |
| [docs/workday-novo-cliente.md](docs/workday-novo-cliente.md) | Setup do tenant Workday (ISU, ISSG, domínios, API Client) |
| [docs/referencia-workday-rest.md](docs/referencia-workday-rest.md) | Código JS de referência da comunicação com o Workday |
| [docs/de-para-workday-pmovel.md](docs/de-para-workday-pmovel.md) | Mapeamento de campos Workday → Pmovel e decisões pendentes |
| [docs/banco-de-dados.md](docs/banco-de-dados.md) | Schema MySQL, migrations e política de dados |
| [docs/fase-1-colaboradores.md](docs/fase-1-colaboradores.md) | Fase 1: fluxo, validação na API real, tratamento manual, regra de duplicidade do Pmovel |
| [docs/roadmap-fases.md](docs/roadmap-fases.md) | Roadmap das Fases 2, 3 e 4 |

## Código de referência

Os arquivos `src/*.js` são a prova de conceito original da comunicação com o
Workday (OAuth `refresh_token`, cliente REST com cache de token e paginação).
São **preservados como referência** e não fazem parte do build NestJS. Detalhes
em [docs/referencia-workday-rest.md](docs/referencia-workday-rest.md).
