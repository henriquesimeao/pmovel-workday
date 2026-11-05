# Integração Pmovel ↔ Workday

Integração da Pmovel com o Workday via **REST API** (OAuth 2.0 com `refresh_token`).

> Para configurar um novo cliente (tenant Workday) do zero, siga o guia
> **[docs/workday-novo-cliente.md](docs/workday-novo-cliente.md)**.

## Requisitos

- Node.js **20.6+** (usa `--env-file` e `fetch` nativos; sem dependências npm)
- Arquivo `.env` preenchido (modelo em [.env.example](.env.example))

## Comandos

| Comando | O que faz |
|---|---|
| `npm run test:connection` | Obtém o access token e faz `GET /workers?limit=3` — valida credenciais e permissões |
| `npm run workers:list` | Lista o nome de todos os workers (paginado, 100 por página) |

Saída esperada do teste de conexão:

```
=== 1) OAuth 2.0 — token (grant_type=refresh_token) ===
OK — access token obtido
=== 2) REST — GET /ccx/api/common/v1/<tenant>/workers?limit=3 ===
OK — total: 82; amostra: Aidan Mitzner | Amanda Baker | Amelia Casias
```

## Estrutura

```
src/
  config.js           Lê/valida o .env e monta os endpoints (token e REST)
  workday-rest.js     Cliente REST: token com cache, get(), paginate()
  test-connection.js  Teste de conectividade (OAuth + workers)
  list-workers.js     Lista nomes de todos os workers
```

### Cliente REST (`src/workday-rest.js`)

```js
import { get, paginate } from './workday-rest.js';

// Uma chamada (path relativo a /ccx/api/, {tenant} é substituído)
const page = await get('common/v1/{tenant}/workers', { limit: 10 });

// Todas as páginas de uma coleção
for await (const worker of paginate('common/v1/{tenant}/workers')) {
  console.log(worker.descriptor);
}
```

- O access token é obtido via `grant_type=refresh_token` e reaproveitado até expirar.
- Se a API responder `401`, o token é renovado e a chamada é repetida uma vez.
- Erros HTTP lançam `WorkdayError` (com `status` e `body`).

## Endpoints

O host dos serviços não é o mesmo da UI: `odpimpl.wd119.myworkday.com` (UI) →
`odpimpl-services1.wd119.myworkday.com` (API). O `config.js` faz essa conversão;
use `WorkdayServicesUrl` no `.env` se o tenant fugir do padrão.

| | URL |
|---|---|
| Token | `https://<host>-services1.../ccx/oauth2/<tenant>/token` |
| REST | `https://<host>-services1.../ccx/api/common/v1/<tenant>/...` |

Os valores corretos de cada tenant aparecem no topo da tarefa **View API Clients** no Workday.

## Histórico — o que foi feito

Ambiente de desenvolvimento: tenant `wwglgmcdcl_extdev` (`odpimpl.wd119.myworkday.com`).

1. **Teste inicial com SOAP** (usuário/senha via WS-Security): autenticou
   (`Get_Integration_Systems` OK), mas `Get_Workers` falhou com *"The task submitted is
   not authorized"* — o usuário não tinha permissão nos domínios de Worker Data.
2. **Decisão: usar REST API.** O código SOAP foi removido.
3. **OAuth `client_credentials` e `password` não funcionam** no Workday
   (`400 Invalid request`). A REST de integração só aceita `refresh_token`.
4. **Client ID/Secret do developer.workday.com não valem no tenant.** Foi registrado
   no próprio tenant o **API Client for Integrations "Pmovel"** (escopos: Staffing,
   Personal Data, Organizations and Roles, Time Off and Leave, Time Tracking,
   Tenant Non-Configurable; refresh token sem expiração).
5. **Criado o ISU** `ISU_Pmovel` e o grupo `ISSG_Pmovel`
   (Integration System Security Group – Unconstrained) com os domínios de Worker Data.
   Refresh token gerado para o `ISU_Pmovel`.
6. **`403 permission denied (S22)`** mesmo com o grupo configurado: os domínios
   estavam só com **Get Only** (permissão de integração/SOAP). A REST API exige
   **View Only** (permissão de Report/Task). Adicionado *View Only* + ativadas as
   mudanças de segurança → **sucesso** (82 workers retornados).
