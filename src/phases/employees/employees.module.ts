import { Module } from '@nestjs/common';
import { SyncModule } from '../../sync/sync.module';
import { WorkdayModule } from '../../workday/workday.module';
import { PmovelModule } from '../../pmovel/pmovel.module';
import { MappingModule } from '../../mapping/mapping.module';

/**
 * Módulo da Fase 1 (colaboradores). O EmployeeSyncJob é implementado e
 * registrado no JobRegistry na Task 9. Por ora, o módulo só declara suas
 * dependências (clientes, mapeamento e sync).
 */
@Module({
  imports: [SyncModule, WorkdayModule, PmovelModule, MappingModule],
})
export class EmployeesModule {}
