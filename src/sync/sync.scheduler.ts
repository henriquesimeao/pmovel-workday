import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { SyncOrchestrator, SyncAlreadyRunningError } from './sync.orchestrator';
import { JobRegistry } from './job-registry';
import { AppConfigService } from '../config/app-config.service';

/**
 * Dispara os jobs registrados de forma agendada (cron configurável via
 * `SYNC_CRON`), quando `SYNC_SCHEDULE_ENABLED=true`.
 *
 * Usa o SchedulerRegistry para criar o CronJob em runtime (o cron vem do env, e
 * não de um decorator estático). O lock contra concorrência é do orquestrador
 * (hasRunning); aqui apenas logamos o conflito e seguimos.
 */
@Injectable()
export class SyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(SyncScheduler.name);

  constructor(
    private readonly orchestrator: SyncOrchestrator,
    private readonly registry: JobRegistry,
    private readonly config: AppConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const { cron, scheduleEnabled } = this.config.sync;
    if (!scheduleEnabled) {
      this.logger.log(
        'Disparo agendado desabilitado (SYNC_SCHEDULE_ENABLED=false)',
      );
      return;
    }

    const job = new CronJob(cron, () => void this.runAll());
    this.schedulerRegistry.addCronJob('sync-all', job as never);
    job.start();
    this.logger.log(`Disparo agendado ativo (cron: ${cron})`);
  }

  /** Executa todos os jobs registrados em sequência. */
  async runAll(): Promise<void> {
    for (const job of this.registry.list()) {
      try {
        await this.orchestrator.run(job, 'scheduled');
      } catch (e) {
        if (e instanceof SyncAlreadyRunningError) {
          this.logger.warn(e.message);
          continue;
        }
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `Falha ao executar ${job.phase}/${job.type}: ${message}`,
        );
      }
    }
  }
}
