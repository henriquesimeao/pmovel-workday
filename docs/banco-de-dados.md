# Banco de dados — MySQL (TypeORM)

O integrador mantém um banco **MySQL** próprio para estado das sincronizações,
de/para de CNPJ e cursores de diff. O schema é versionado em **migrations**
(sem `synchronize` em produção).

## Tabelas

| Tabela | Propósito |
|---|---|
| `sync_run` | Uma execução (lote) de sincronização: fase, tipo, trigger, status, contadores (total/sucesso/falha/skip), início/fim e erro global. |
| `sync_item` | Resultado de cada registro dentro de uma run: `external_id`, operação (create/update/inactivate/reactivate/none), status (success/failure/skipped), mensagem de erro e resumo do payload. FK para `sync_run` (ON DELETE CASCADE). |
| `cnpj_mapping` | De/para manual legal entity (Workday) ↔ CNPJ (Pmovel). Populado pela operação. |
| `sync_cursor` | Cursor por job (ex.: `employees:full`): data da última execução bem-sucedida, para buscar apenas o que mudou (diffs). |

## Configuração

Variáveis no `.env` (ver `.env.example`): `DB_HOST`, `DB_PORT`, `DB_USER`,
`DB_PASSWORD`, `DB_NAME`.

## Migrations

```bash
# Aplicar as migrations (cria/atualiza o schema)
npm run migration:run

# Reverter a última migration
npm run migration:revert

# Gerar uma nova migration a partir de mudanças nas entidades
npm run migration:generate -- src/persistence/migrations/NomeDaMigration
```

A migration inicial (`InitialSchema`) cria as quatro tabelas no dialeto MySQL.

> **Nota de verificação:** no ambiente de desenvolvimento desta entrega não havia
> um MySQL acessível, então a migration **não foi aplicada contra um MySQL real**.
> O mapeamento objeto-relacional foi validado por testes de integração em SQLite
> em memória (`persistence.repositories.spec.ts`), e a migration usa a API
> `Table`/`TableForeignKey` do TypeORM. Rode `npm run migration:run` contra o seu
> MySQL e confirme a criação das tabelas antes de usar em produção.

## Política de dados e PII

- `sync_item.payloadSummary` guarda um **resumo** do que foi enviado/decidido, não
  o payload completo — evita acumular PII em texto livre.
- Mensagens de erro são truncadas (ex.: `errorMessage` da run em 2000 chars).
