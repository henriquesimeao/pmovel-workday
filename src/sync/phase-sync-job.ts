import { SyncOperation } from '../persistence/entities/sync-item.entity';

/**
 * Resultado do processamento de um item pelo job.
 * - `skipped`: idempotência (nada a fazer).
 * - `operation`: o que foi aplicado no destino (para o relatório da run).
 * - `summary`: resumo curto para auditoria (sem PII em excesso).
 */
export interface ItemResult {
  skipped?: boolean;
  operation: SyncOperation;
  summary?: string;
}

/**
 * Um item a processar, com sua chave de correlação (external_id).
 * O payload é opaco para o orquestrador; só o job sabe interpretá-lo.
 */
export interface SyncItemInput<T = unknown> {
  externalId: string;
  payload: T;
}

/**
 * Contrato de um job de fase. O SyncOrchestrator cuida do lote, da política de
 * falhas, do cursor e do registro; o job implementa apenas a lógica específica:
 *
 * - `key`: identificador estável do job (ex.: 'employees:full'), usado no cursor
 *   e no lock.
 * - `phase`/`type`: rotulam a run (ex.: 'employees' / 'full').
 * - `fetchItems`: busca os registros da origem a processar desde `since` (diff).
 * - `processItem`: aplica um item no destino e retorna o resultado.
 */
export interface PhaseSyncJob<T = unknown> {
  readonly key: string;
  readonly phase: string;
  readonly type: string;

  fetchItems(since: Date | null): Promise<SyncItemInput<T>[]>;
  processItem(item: SyncItemInput<T>): Promise<ItemResult>;
}
