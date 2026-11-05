import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PersistenceModule } from '../persistence/persistence.module';
import { SyncOrchestrator } from './sync.orchestrator';
import { JobRegistry } from './job-registry';
import { SyncController } from './sync.controller';
import { SyncScheduler } from './sync.scheduler';

/**
 * Módulo de sincronização: orquestrador, registro de jobs, gatilhos HTTP e
 * agendado. Os módulos de fase (ex.: EmployeesModule) importam este módulo para
 * registrar seus jobs no JobRegistry.
 */
@Module({
  imports: [ScheduleModule.forRoot(), PersistenceModule],
  controllers: [SyncController],
  providers: [SyncOrchestrator, JobRegistry, SyncScheduler],
  exports: [SyncOrchestrator, JobRegistry],
})
export class SyncModule {}
