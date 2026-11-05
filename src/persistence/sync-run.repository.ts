import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncRun, SyncRunStatus } from './entities/sync-run.entity';
import {
  SyncItem,
  SyncItemStatus,
  SyncOperation,
} from './entities/sync-item.entity';

export interface RecordItemInput {
  externalId: string;
  operation: SyncOperation;
  status: SyncItemStatus;
  errorMessage?: string | null;
  payloadSummary?: string | null;
}

/**
 * Acesso de persistência às execuções de sincronização (runs) e seus itens.
 * Encapsula o TypeORM em métodos de intenção clara, usados pelo
 * SyncOrchestrator (Task 8).
 */
@Injectable()
export class SyncRunRepository {
  constructor(
    @InjectRepository(SyncRun)
    private readonly runs: Repository<SyncRun>,
    @InjectRepository(SyncItem)
    private readonly items: Repository<SyncItem>,
  ) {}

  /** Abre uma nova run no estado RUNNING. */
  startRun(phase: string, type: string, trigger: string): Promise<SyncRun> {
    const run = this.runs.create({
      phase,
      type,
      trigger,
      status: SyncRunStatus.RUNNING,
    });
    return this.runs.save(run);
  }

  /** Registra o resultado de um item e incrementa o contador correspondente. */
  async recordItem(runId: number, input: RecordItemInput): Promise<SyncItem> {
    const item = this.items.create({
      runId,
      externalId: input.externalId,
      operation: input.operation,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      payloadSummary: input.payloadSummary ?? null,
    });
    const saved = await this.items.save(item);

    const field =
      input.status === SyncItemStatus.SUCCESS
        ? 'successCount'
        : input.status === SyncItemStatus.FAILURE
          ? 'failureCount'
          : 'skippedCount';
    await this.runs.increment({ id: runId }, field, 1);
    await this.runs.increment({ id: runId }, 'totalCount', 1);

    return saved;
  }

  /** Fecha a run com sucesso. */
  completeRun(runId: number): Promise<void> {
    return this.runs
      .update(runId, {
        status: SyncRunStatus.COMPLETED,
        finishedAt: new Date(),
      })
      .then(() => undefined);
  }

  /** Marca a run como falha (ex.: erro irrecuperável na origem). */
  failRun(runId: number, errorMessage: string): Promise<void> {
    return this.runs
      .update(runId, {
        status: SyncRunStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: errorMessage.slice(0, 2000),
      })
      .then(() => undefined);
  }

  /** Busca uma run com seus itens (para o endpoint GET /sync/runs/:id). */
  findById(runId: number): Promise<SyncRun | null> {
    return this.runs.findOne({ where: { id: runId }, relations: { items: true } });
  }

  /** Indica se existe uma run RUNNING para o par phase/type (lock simples). */
  async hasRunning(phase: string, type: string): Promise<boolean> {
    const count = await this.runs.count({
      where: { phase, type, status: SyncRunStatus.RUNNING },
    });
    return count > 0;
  }
}
