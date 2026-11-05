# Integração Pmovel ↔ Workday

Aplicação integradora em **NestJS + TypeScript** que sincroniza dados entre o
**Workday** e o **Pmovel** via REST API, em fases.

- **Fase 1** (em desenvolvimento): colaboradores — admissões, atualizações e
  demissões, no sentido **Workday → Pmovel**.
- **Fases 2–4** (roadmap): horas extras/verbas de folha, férias e afastamentos.

Visão completa da arquitetura, decisões e status: **[docs/arquitetura.md](docs/arquitetura.md)**.

## Requisitos

- Node.js **20.6+** (desenvolvido/testado em Node 25)
- MySQL 8+ (estado das sincronizações, de/para CNPJ, cursores)
- Arquivo `.env` preenchido (modelo em [.env.example](.env.example))

## Setup

```bash
npm install
cp .env.example .env   # preencha com as credenciais do tenant e do Pmovel
npm run build
npm run start:dev
```

Valide com o health check:

```bash
curl http://localhost:3000/health
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
curl -X POST http://localhost:3000/sync/employees/full
# { "runId": 1, "phase": "employees", "type": "full" }

# consulta o resultado (status, contadores, itens com sucesso/falha)
curl http://localhost:3000/sync/runs/1

# lista os jobs registrados
curl http://localhost:3000/sync/jobs
```

Disparo **agendado**: no `.env`, defina `SYNC_SCHEDULE_ENABLED=true` e o
`SYNC_CRON` (ex.: `0 * * * *` para de hora em hora).

### Configuração do mapeamento

- **Campos Workday → Pmovel**: `src/mapping/mapping.config.ts`
  (`DEFAULT_EMPLOYEE_MAPPING`). Modos: direto, de-para por tabela, ou default fixo.
  Base e decisões pendentes em [docs/de-para-workday-pmovel.md](docs/de-para-workday-pmovel.md).
- **CNPJ ↔ legal entity**: tabela `cnpj_mapping` (populada pela operação).

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/arquitetura.md](docs/arquitetura.md) | Arquitetura, fases, decisões de projeto, status |
| [docs/workday-novo-cliente.md](docs/workday-novo-cliente.md) | Setup do tenant Workday (ISU, ISSG, domínios, API Client) |
| [docs/referencia-workday-rest.md](docs/referencia-workday-rest.md) | Código JS de referência da comunicação com o Workday |
| [docs/de-para-workday-pmovel.md](docs/de-para-workday-pmovel.md) | Mapeamento de campos Workday → Pmovel e decisões pendentes |
| [docs/banco-de-dados.md](docs/banco-de-dados.md) | Schema MySQL, migrations e política de dados |
| [docs/fase-1-colaboradores.md](docs/fase-1-colaboradores.md) | Fase 1: fluxo, operação e gaps de dados |
| [docs/roadmap-fases.md](docs/roadmap-fases.md) | Roadmap das Fases 2, 3 e 4 |

## Código de referência

Os arquivos `src/*.js` são a prova de conceito original da comunicação com o
Workday (OAuth `refresh_token`, cliente REST com cache de token e paginação).
São **preservados como referência** e não fazem parte do build NestJS. Detalhes
em [docs/referencia-workday-rest.md](docs/referencia-workday-rest.md).
