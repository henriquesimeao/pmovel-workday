import { Injectable, Logger } from '@nestjs/common';
import { SyncRunRepository } from '../persistence/sync-run.repository';
import { SyncCursorRepository } from '../persistence/sync-cursor.repository';
import {
  SyncItemStatus,
  SyncOperation,
} from '../persistence/entities/sync-item.entity';
import { PhaseSyncJob } from './phase-sync-job';
import { ManualReviewError } from './manual-review.error';

/** Erro quando já há uma execução do mesmo job em andamento. */
export class SyncAlreadyRunningError extends Error {
  constructor(phase: string, type: string) {
    super(`Já existe uma sincronização em andamento para ${phase}/${type}`);
    this.name = 'SyncAlreadyRunningError';
  }
}

/**
 * Motor genérico de sincronização.
 *
 * Executa um PhaseSyncJob em lote:
 * 1. Verifica lock (não roda o mesmo job em paralelo).
 * 2. Abre uma `sync_run`.
 * 3. Lê os itens da origem desde o cursor (diff).
 * 4. Processa item a item: **continua em caso de falha**, registrando cada
 *    resultado em `sync_item` (política de falhas acordada).
 * 5. Atualiza o cursor e fecha a run com os contadores.
 *
 * Se a própria busca na origem falhar (erro irrecuperável), a run é marcada
 * como FAILED e o cursor NÃO avança.
 */
@Injectable()
export class SyncOrchestrator {
  private readonly logger = new Logger(SyncOrchestrator.name);

  constructor(
    private readonly runs: SyncRunRepository,
    private readonly cursors: SyncCursorRepository,
  ) {}

  /**
   * Executa um job. `trigger` indica a origem do disparo ('manual'/'scheduled').
   * @returns o id da run criada.
   */
  async run(
    job: PhaseSyncJob,
    trigger: 'manual' | 'scheduled',
  ): Promise<number> {
    if (await this.runs.hasRunning(job.phase, job.type)) {
      throw new SyncAlreadyRunningError(job.phase, job.type);
    }

    const run = await this.runs.startRun(job.phase, job.type, trigger);
    const startedAt = new Date();
    this.logger.log(
      `[run ${run.id}] iniciando ${job.phase}/${job.type} (${trigger})`,
    );

    let items;
    try {
      const since = await this.cursors.getLastRunAt(job.key);
      items = await job.fetchItems(since);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`[run ${run.id}] falha ao buscar origem: ${message}`);
      await this.runs.failRun(run.id, message);
      return run.id;
    }

    this.logger.log(`[run ${run.id}] ${items.length} item(ns) a processar`);

    const manualReview: ManualReviewError[] = [];

    for (const item of items) {
      try {
        const result = await job.processItem(item);
        await this.runs.recordItem(run.id, {
          externalId: item.externalId,
          operation: result.operation,
          status: result.skipped
            ? SyncItemStatus.SKIPPED
            : SyncItemStatus.SUCCESS,
          payloadSummary: result.summary ?? null,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (e instanceof ManualReviewError) {
          manualReview.push(e);
        }
        this.logger.warn(
          `[run ${run.id}] item ${item.externalId} falhou: ${message}`,
        );
        await this.runs.recordItem(run.id, {
          externalId: item.externalId,
          operation: SyncOperation.NONE,
          status: SyncItemStatus.FAILURE,
          errorMessage: message.slice(0, 2000),
        });
      }
    }

    // Destaca, juntos, os itens que precisam de uma pessoa.
    if (manualReview.length) {
      this.logger.warn(
        `[run ${run.id}] ATENÇÃO: ${manualReview.length} item(ns) para ${ManualReviewError.MARKER}:`,
      );
      for (const m of manualReview) {
        this.logger.warn(`[run ${run.id}]   - ${m.reason} | ${m.highlight}`);
      }
    }

    // Cursor só avança quando a run conclui (mesmo com falhas parciais de item).
    await this.cursors.save(job.key, startedAt);
    await this.runs.completeRun(run.id);
    this.logger.log(`[run ${run.id}] concluída`);
    return run.id;
  }
}
