import { Module, OnModuleInit } from '@nestjs/common';
import { SyncModule } from '../../sync/sync.module';
import { WorkdayModule } from '../../workday/workday.module';
import { PmovelModule } from '../../pmovel/pmovel.module';
import { MappingModule } from '../../mapping/mapping.module';
import { JobRegistry } from '../../sync/job-registry';
import { EmployeeSyncJob } from './employee-sync.job';

/**
 * Módulo da Fase 1 (colaboradores). Registra o EmployeeSyncJob no JobRegistry
 * no boot, tornando-o disparável via `POST /sync/employees/full` e pelo
 * scheduler.
 */
@Module({
  imports: [SyncModule, WorkdayModule, PmovelModule, MappingModule],
  providers: [EmployeeSyncJob],
})
export class EmployeesModule implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly job: EmployeeSyncJob,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.job);
  }
}
