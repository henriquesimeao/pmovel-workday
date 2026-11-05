# Configurar um novo cliente Workday

Passo a passo para conectar a integração Pmovel ao tenant Workday de um novo cliente,
do zero até o teste de conexão funcionando.

**Quem executa:** as etapas 1 a 5 são feitas **dentro do Workday do cliente**, por alguém
com perfil de administrador de segurança/integrações (normalmente o time de Workday do
cliente). A etapa 6 é feita pela Pmovel.

**Tempo estimado:** 30–45 min.

## Visão geral

```
1. Usuário técnico (ISU) ──► 2. Grupo de segurança (ISSG) ──► 3. Permissões de domínio (View + Get)
                                                                      │
                                                     4. Activate Pending Security Policy Changes
                                                                      │
5. API Client for Integrations ──► Refresh token para o ISU ──► 6. .env + npm run test:connection
```

Busque cada tarefa pelo nome na barra de pesquisa do Workday.

---

## 1. Criar o usuário de integração (ISU)

Tarefa **Create Integration System User**

| Campo | Valor |
|---|---|
| User Name | `ISU_Pmovel` |
| New Password / Verify New Password | senha forte (exigida pelo Workday, não é usada pela API) |
| Require New Password at Next Sign In | **desmarcado** |
| Session Timeout Minutes | `0` |
| Do Not Allow UI Sessions | **marcado** |

Depois, tarefa **Maintain Password Rules** → adicionar `ISU_Pmovel` em
*System Users exempt from password expiration*.

> Por que um ISU e não o usuário de uma pessoa: a integração não pode parar se a
> pessoa sair da empresa, trocar de cargo ou de senha.

## 2. Criar o grupo de segurança (ISSG)

Tarefa **Create Security Group**

| Campo | Valor |
|---|---|
| Type of Tenanted Security Group | **Integration System Security Group (Unconstrained)** |
| Name | `ISSG_Pmovel` |
| Integration System Users (próxima tela) | `ISU_Pmovel` |

**Conferir:** tarefa **View Security Groups for User** → `ISU_Pmovel` deve listar
`ISSG_Pmovel`.

## 3. Dar permissões nos domínios

Tarefa **Maintain Permissions for Security Group** → Operation **Maintain** →
Source Security Group `ISSG_Pmovel` → aba **Domain Security Policy Permissions**.

Adicione uma linha por domínio. No campo **View/Modify Access** coloque
**os dois valores: `View Only` e `Get Only`**.

| Domínio | Área funcional | Para quê |
|---|---|---|
| Worker Data: Public Worker Reports | Staffing | Listagem básica de workers |
| Worker Data: Workers | Staffing | Dados do worker |
| Worker Data: Current Staffing Information | Staffing | Cargo, posição, status |
| Worker Data: Organization Information | Staffing | Organizações / gestor |
| Person Data: Personal Data | Personal Data | Dados pessoais |
| Worker Data: Compensation Grade | Core Compensation | Grade salarial (se necessário) |

> ⚠️ **Ponto crítico:** `Get Only` sozinho **não basta** para a REST API — ele só libera
> web services SOAP. Sem `View Only` a API responde `403 permission denied (S22)`.
>
> Se a integração for **gravar** dados no Workday, use também `Put` / `Modify` nos
> domínios correspondentes.

**Nomes de domínio variam entre tenants.** Digite parte do nome no campo
(`Person Data`, `Compensation`, `Time Off`...) para achar o exato. Se não aparecer nada,
o módulo provavelmente não está ativo no tenant. Para descobrir qual domínio protege
uma operação específica, use **View Security for Securable Item** (ex.: `Get_Workers`).

## 4. Ativar as mudanças de segurança

Tarefa **Activate Pending Security Policy Changes** → comentário → marcar **Confirm** → OK.

> Sem esta etapa **nenhuma** permissão das etapas 2–3 tem efeito. Repita sempre que
> alterar permissões.

**Conferir:** tarefa **View Security Group** → `ISSG_Pmovel` → a coluna *Operation*
deve mostrar View **e** Get (não apenas *Get Only*).

## 5. Registrar o API Client e gerar o refresh token

### 5.1 Registrar o client

Tarefa **Register API Client for Integrations**

| Campo | Valor |
|---|---|
| Client Name | `Pmovel` |
| Non-Expiring Refresh Tokens | **Sim** |
| Scope (Functional Areas) | **Staffing**, **Personal Data**, **Organizations and Roles** (+ *Time Off and Leave*, *Time Tracking*, *Core Compensation* se necessário) |
| Include Workday Owned Scope | Sim |

> ⚠️ Ao salvar, o Workday exibe **Client ID** e **Client Secret** — o secret aparece
> **uma única vez**. Copie (copiar/colar, não transcrever) antes de clicar em *Done*.
>
> O escopo do client precisa cobrir a área funcional de cada domínio liberado na etapa 3.

> ⚠️ Use um client registrado **no tenant do cliente**. Credenciais criadas no
> developer.workday.com **não funcionam** no tenant (`400 Invalid request`).

### 5.2 Gerar o refresh token

Tarefa **View API Clients** → aba **API Clients for Integrations** → menu `…` do
client **Pmovel** → **API Client** → **Manage Refresh Tokens for Integrations**

| Campo | Valor |
|---|---|
| Workday Account | `ISU_Pmovel` |
| Generate New Refresh Token | **marcado** |

Na tela de confirmação, copie o valor do campo **Refresh Token** (string longa, só
letras e números, sem espaços).

> Gerar um novo refresh token invalida o anterior daquela conta.

### 5.3 Anotar os endpoints

No topo da tarefa **View API Clients** aparecem *Workday REST API Endpoint* e
*Token Endpoint* — confira se o host (`...-services1...`) bate com o que o
`config.js` gera; senão, preencha `WorkdayServicesUrl` no `.env`.

## 6. Configurar e testar (Pmovel)

Dados que o cliente deve enviar à Pmovel (por canal seguro — não por e-mail/chat aberto):

- Nome do tenant e URL de acesso ao Workday
- Client ID e Client Secret (etapa 5.1)
- Refresh Token (etapa 5.2)

Crie o `.env` a partir do [.env.example](../.env.example):

```env
WorkdayTenant=<tenant>
WorkdayTenantUrl=https://<host>.wdNNN.myworkday.com/<tenant>
WorkdayClientId=<client id>
WorkdayClientSecret=<client secret>
WorkdayRefreshToken=<refresh token>
```

Rode:

```bash
npm run test:connection
```

**Sucesso:**

```
OK — access token obtido
OK — total: <N>; amostra: <nome> | <nome> | <nome>
```

---

## Erros comuns

| Erro | Causa | Solução |
|---|---|---|
| `400 {"error": "Invalid request"}` no token | Client ID/Secret não pertencem ao tenant (ex.: do developer.workday.com) ou grant type não suportado | Usar o client da etapa 5.1; a integração só usa `refresh_token` |
| `400 {"error": "invalid_grant"}` no token | Refresh token errado, incompleto, com espaços, de outro client ou já substituído por um novo | Gerar de novo (5.2) e colar o valor exato |
| `403 permission denied` (`S22`) na REST | Domínio sem **View Only**, mudanças não ativadas, ou token gerado para outra conta | Etapas 3 e 4; conferir conta em 5.2 |
| `403`/lista vazia em um recurso específico | Falta o domínio daquele dado ou o escopo no client | **View Security for Securable Item** → liberar domínio (View+Get) → ativar → incluir área funcional no escopo do client |
| SOAP: *"The task submitted is not authorized"* | Mesmo problema de permissão de domínio | Etapas 3 e 4 |
| `Variáveis ausentes no .env` | `.env` incompleto | Preencher conforme `.env.example` |

## Checklist

- [ ] `ISU_Pmovel` criado, senha sem expiração, sem sessão de UI
- [ ] `ISSG_Pmovel` (Unconstrained) com `ISU_Pmovel`
- [ ] Domínios com **View Only + Get Only**
- [ ] Activate Pending Security Policy Changes executado
- [ ] API Client for Integrations `Pmovel` com escopos corretos e refresh token sem expiração
- [ ] Client ID / Secret copiados
- [ ] Refresh token gerado para `ISU_Pmovel`
- [ ] `.env` preenchido e `npm run test:connection` OK
