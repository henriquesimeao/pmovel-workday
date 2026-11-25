import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { SyncRunRepository } from '../persistence/sync-run.repository';
import { SyncCursorRepository } from '../persistence/sync-cursor.repository';
import {
  SyncItemStatus,
  SyncOperation,
} from '../persistence/entities/sync-item.entity';
import { JobRunContext, PhaseSyncJob } from './phase-sync-job';
import { ManualReviewError } from './manual-review.error';

/** Erro quando já há uma execução do mesmo job em andamento. */
export class SyncAlreadyRunningError extends Error {
  constructor(phase: string, type: string) {
    super(`Já existe uma sincronização em andamento para ${phase}/${type}`);
    this.name = 'SyncAlreadyRunningError';
  }
}

/** Origem do disparo de uma run: HTTP, agendador ou solicitação vinda do Pmovel. */
export type SyncTrigger = 'manual' | 'scheduled' | 'pmovel';

/** Mensagem gravada nas runs que estavam RUNNING quando a aplicação subiu. */
export const INTERRUPTED_RUN_MESSAGE =
  'interrompida: a aplicação foi reiniciada durante a execução';

/**
 * Motor genérico de sincronização.
 *
 * Executa um PhaseSyncJob em lote, em duas etapas:
 * - `start`: verifica o lock (não roda o mesmo job em paralelo) e abre a
 *   `sync_run`. É síncrono para quem chama, então o conflito (409) continua
 *   sendo informado na hora.
 * - `execute`: lê os itens da origem desde o cursor e processa item a item,
 *   **continuando em caso de falha** e registrando cada resultado em
 *   `sync_item`. No fim, atualiza o cursor e fecha a run.
 *
 * `run` faz as duas etapas e espera o fim (agendador, `?wait=true`). `launch`
 * devolve o id da run logo após o `start` e executa em segundo plano (HTTP).
 *
 * Garantias contra run presa em RUNNING (a aplicação roda em uma instância):
 * - qualquer erro inesperado em `execute` fecha a run como FAILED;
 * - ao subir, toda run RUNNING que sobrou de um processo anterior é marcada
 *   como FAILED (`onModuleInit`, antes do agendador e do servidor HTTP);
 * - um lock em memória impede que dois disparos simultâneos passem juntos pela
 *   verificação do banco.
 *
 * Se a busca na origem ou a execução falhar, a run fica FAILED e o cursor NÃO
 * avança.
 */
@Injectable()
export class SyncOrchestrator
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(SyncOrchestrator.name);

  /** Jobs (phase/type) em andamento neste processo. */
  private readonly activeJobs = new Set<string>();

  /** Execuções em segundo plano ainda não concluídas. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly runs: SyncRunRepository,
    private readonly cursors: SyncCursorRepository,
  ) {}

  /** Fecha as runs que ficaram RUNNING por queda ou reinício da aplicação. */
  async onModuleInit(): Promise<void> {
    const closed = await this.runs.failAllRunning(INTERRUPTED_RUN_MESSAGE);
    if (closed > 0) {
      this.logger.warn(
        `${closed} run(s) RUNNING de uma execução anterior marcada(s) como FAILED`,
      );
    }
  }

  /** No desligamento, espera as execuções em segundo plano terminarem. */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.inFlight.size === 0) return;
    this.logger.log(
      `aguardando ${this.inFlight.size} execução(ões) em andamento antes de encerrar`,
    );
    await Promise.allSettled([...this.inFlight]);
  }

  /**
   * Executa um job e espera o fim. `trigger` indica a origem do disparo.
   * @returns o id da run criada.
   */
  async run(
    job: PhaseSyncJob,
    trigger: SyncTrigger,
    params?: unknown,
  ): Promise<number> {
    const runId = await this.start(job, trigger);
    await this.track(this.execute(job, { runId, params }));
    return runId;
  }

  /**
   * Abre a run e executa o job em segundo plano.
   * @returns o id da run, assim que ela é criada.
   */
  async launch(
    job: PhaseSyncJob,
    trigger: SyncTrigger,
    params?: unknown,
  ): Promise<number> {
    const runId = await this.start(job, trigger);
    void this.track(this.execute(job, { runId, params }));
    return runId;
  }

  /** Verifica o lock e abre a run. Lança SyncAlreadyRunningError. */
  private async start(
    job: PhaseSyncJob,
    trigger: SyncTrigger,
  ): Promise<number> {
    const lockKey = SyncOrchestrator.lockKey(job);
    if (this.activeJobs.has(lockKey)) {
      throw new SyncAlreadyRunningError(job.phase, job.type);
    }
    // Reserva o lock antes do primeiro await: dois disparos simultâneos não
    // passam juntos pela checagem do banco.
    this.activeJobs.add(lockKey);
    try {
      if (await this.runs.hasRunning(job.phase, job.type)) {
        throw new SyncAlreadyRunningError(job.phase, job.type);
      }
      const run = await this.runs.startRun(job.phase, job.type, trigger);
      this.logger.log(
        `[run ${run.id}] iniciando ${job.phase}/${job.type} (${trigger})`,
      );
      return run.id;
    } catch (e) {
      this.activeJobs.delete(lockKey);
      throw e;
    }
  }

  /**
   * Processa a run aberta por `start`. Nunca rejeita: qualquer erro fecha a run
   * como FAILED, e o lock em memória é sempre liberado.
   */
  private async execute(
    job: PhaseSyncJob,
    context: JobRunContext,
  ): Promise<void> {
    const { runId } = context;
    try {
      await this.process(job, context);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`[run ${runId}] interrompida por erro: ${message}`);
      try {
        await this.runs.failRun(runId, `erro inesperado: ${message}`);
      } catch (closeError) {
        // Banco indisponível: a run fica RUNNING até a próxima subida da
        // aplicação, que a marca como FAILED (onModuleInit).
        const detail =
          closeError instanceof Error ? closeError.message : String(closeError);
        this.logger.error(
          `[run ${runId}] não foi possível marcar como FAILED: ${detail}`,
        );
      }
    } finally {
      this.activeJobs.delete(SyncOrchestrator.lockKey(job));
    }
  }

  /** Corpo do lote. Pode lançar; quem trata é `execute`. */
  private async process(
    job: PhaseSyncJob,
    context: JobRunContext,
  ): Promise<void> {
    const { runId } = context;
    const startedAt = new Date();

    let items;
    try {
      const since = await this.cursors.getLastRunAt(job.key);
      items = await job.fetchItems(since, context);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`[run ${runId}] falha ao buscar origem: ${message}`);
      await this.runs.failRun(runId, message);
      return;
    }

    this.logger.log(`[run ${runId}] ${items.length} item(ns) a processar`);

    const manualReview: ManualReviewError[] = [];

    for (const item of items) {
      try {
        const result = await job.processItem(item, context);
        await this.runs.recordItem(runId, {
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
          `[run ${runId}] item ${item.externalId} falhou: ${message}`,
        );
        await this.runs.recordItem(runId, {
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
        `[run ${runId}] ATENÇÃO: ${manualReview.length} item(ns) para ${ManualReviewError.MARKER}:`,
      );
      for (const m of manualReview) {
        this.logger.warn(`[run ${runId}]   - ${m.reason} | ${m.highlight}`);
      }
    }

    // Cursor só avança quando a run conclui (mesmo com falhas parciais de item).
    await this.cursors.save(job.key, startedAt);
    await this.runs.completeRun(runId);
    this.logger.log(`[run ${runId}] concluída`);
  }

  /** Registra a execução até ela terminar (para o desligamento esperar). */
  private track(execution: Promise<void>): Promise<void> {
    this.inFlight.add(execution);
    return execution.finally(() => this.inFlight.delete(execution));
  }

  private static lockKey(job: PhaseSyncJob): string {
    return `${job.phase}/${job.type}`;
  }
}
