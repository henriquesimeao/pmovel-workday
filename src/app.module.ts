import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { PersistenceModule } from './persistence/persistence.module';
import { SyncModule } from './sync/sync.module';
import { EmployeesModule } from './phases/employees/employees.module';
import { PayrollExportModule } from './phases/payroll-export/payroll-export.module';

/**
 * Módulo raiz da aplicação.
 *
 * - AppConfigModule: configuração global validada no boot.
 * - PersistenceModule: MySQL (TypeORM).
 * - SyncModule: orquestrador, gatilhos HTTP e agendado.
 * - EmployeesModule: Fase 1 (colaboradores). Registra seu job no SyncModule.
 * - PayrollExportModule: Fase 2 (verbas do ciclo), por solicitação do Pmovel.
 */
@Module({
  imports: [
    AppConfigModule,
    PersistenceModule,
    SyncModule,
    EmployeesModule,
    PayrollExportModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
