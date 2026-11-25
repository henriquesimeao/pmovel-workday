import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { PmovelClient } from '../../pmovel/pmovel.client';
import {
  PayrollExport,
  PayrollExportFinishDto,
} from '../../pmovel/pmovel.types';
import { SyncOrchestrator } from '../../sync/sync.orchestrator';
import { SyncRunRepository } from '../../persistence/sync-run.repository';
import { SyncRunStatus } from '../../persistence/entities/sync-run.entity';
import { SyncItemStatus } from '../../persistence/entities/sync-item.entity';
import { PayrollExportJob, PayrollExportParams } from './payroll-export.job';

/** Mensagem das solicitações que estavam em processamento quando o integrador subiu. */
export const INTERRUPTED_EXPORT_MESSAGE =
  'interrompido: o integrador foi reiniciado durante o envio; dispare o envio de novo';

/**
 * Consulta periódica das solicitações de envio de verbas feitas pelo RH no
 * Pmovel (Fase 2). Liga com `PAYROLL_EXPORT_ENABLED=true`.
 *
 * A cada `PAYROLL_EXPORT_POLL_SECONDS`:
 * 1. lista as solicitações `pending` do destino `workday`;
 * 2. assume uma (`start`); se outro processo já assumiu (409), pula;
 * 3. executa o `PayrollExportJob` pelo orquestrador (uma run por solicitação);
 * 4. devolve o resultado ao Pmovel (`finish`): status, contadores, avisos e os
 *    erros por colaborador/verba.
 *
 * Uma rodada por vez: se a anterior ainda não terminou, a próxima é ignorada.
 *
 * Ao subir, as solicitações que ficaram `processing` (o integrador caiu no meio)
 * são devolvidas como `failed`, para o RH disparar de novo. Isso é seguro porque
 * a aplicação roda em uma única instância. Reenviar não duplica horas: o mesmo
 * id de lançamento atualiza no Workday.
 */
@Injectable()
export class PayrollExportPoller
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PayrollExportPoller.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly pmovel: PmovelClient,
    private readonly orchestrator: SyncOrchestrator,
    private readonly runs: SyncRunRepository,
    private readonly job: PayrollExportJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { enabled, pollSeconds, destination } = this.config.payrollExport;
    if (!enabled) {
      this.logger.log(
        'Envio de verbas desabilitado (PAYROLL_EXPORT_ENABLED=false)',
      );
      return;
    }
    await this.recoverInterrupted();
    this.timer = setInterval(() => void this.tick(), pollSeconds * 1000);
    this.logger.log(
      `Envio de verbas ativo: destino ${destination}, consulta a cada ${pollSeconds}s`,
    );
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Devolve como `failed` as solicitações que ficaram em processamento. */
  async recoverInterrupted(): Promise<void> {
    try {
      const stuck = await this.pmovel.listPayrollExports('processing');
      for (const request of stuck) {
        await this.pmovel.finishPayrollExport(request.id, {
          status: 'failed',
          summary: null,
          errors: [],
          error_message: INTERRUPTED_EXPORT_MESSAGE,
        });
        this.logger.warn(
          `solicitação ${request.id} estava em processamento ao subir: devolvida como failed`,
        );
      }
    } catch (e) {
      this.logger.error(
        `falha ao recuperar solicitações em processamento: ${PayrollExportPoller.messageOf(e)}`,
      );
    }
  }

  /** Uma rodada de consulta. Pública para testes. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const pending = await this.pmovel.listPayrollExports('pending');
      for (const candidate of pending) {
        const request = await this.pmovel.startPayrollExport(candidate.id);
        if (!request) continue; // outro processo assumiu
        await this.process(request);
      }
    } catch (e) {
      this.logger.error(
        `falha ao consultar solicitações de envio: ${PayrollExportPoller.messageOf(e)}`,
      );
    } finally {
      this.busy = false;
    }
  }

  /** Executa uma solicitação já assumida e devolve o resultado ao Pmovel. */
  private async process(request: PayrollExport): Promise<void> {
    let result: PayrollExportFinishDto;
    try {
      const params: PayrollExportParams = { request };
      const runId = await this.orchestrator.run(this.job, 'pmovel', params);
      result = await this.buildResult(request, runId);
    } catch (e) {
      this.job.takeReport(request.id);
      result = {
        status: 'failed',
        summary: null,
        errors: [],
        error_message: PayrollExportPoller.messageOf(e).slice(0, 2000),
      };
    }

    try {
      await this.pmovel.finishPayrollExport(request.id, result);
      this.logger.log(`solicitação ${request.id}: ${result.status}`);
    } catch (e) {
      // Os lançamentos já foram gravados; só o retorno ao Pmovel falhou. A
      // solicitação fica em processamento até a próxima subida, que a devolve
      // como failed (reenviar não duplica).
      this.logger.error(
        `solicitação ${request.id}: falha ao devolver o resultado (${result.status}) ao Pmovel: ${PayrollExportPoller.messageOf(e)}`,
      );
    }
  }

  /** Monta o `finish` a partir da run e do relatório do job. */
  private async buildResult(
    request: PayrollExport,
    runId: number,
  ): Promise<PayrollExportFinishDto> {
    const report = this.job.takeReport(request.id);
    const run = await this.runs.findById(runId);
    if (!run || run.status === SyncRunStatus.FAILED) {
      return {
        status: 'failed',
        summary: null,
        errors: [],
        error_message: run?.errorMessage ?? `run ${runId} não encontrada`,
      };
    }
    const errors = (run.items ?? [])
      .filter((i) => i.status === SyncItemStatus.FAILURE)
      .map((i) => {
        const [externalId, ...code] = i.externalId.split('/');
        return {
          external_id: externalId || null,
          code: code.join('/') || null,
          message: i.errorMessage ?? 'erro sem mensagem',
        };
      });
    return {
      status: errors.length ? 'completed_with_errors' : 'completed',
      summary: {
        employees: report.employees,
        inputs_sent: report.sent,
        inputs_zeroed: report.zeroed,
        failures: errors.length,
        warnings: report.warnings,
      },
      errors,
      error_message: null,
    };
  }

  private static messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
