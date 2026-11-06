import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { PersistenceModule } from './persistence/persistence.module';
import { SyncModule } from './sync/sync.module';
import { EmployeesModule } from './phases/employees/employees.module';

/**
 * Módulo raiz da aplicação.
 *
 * - AppConfigModule: configuração global validada no boot.
 * - PersistenceModule: MySQL (TypeORM).
 * - SyncModule: orquestrador, gatilhos HTTP e agendado.
 * - EmployeesModule: Fase 1 (colaboradores). Registra seu job no SyncModule.
 */
@Module({
  imports: [AppConfigModule, PersistenceModule, SyncModule, EmployeesModule],
  controllers: [HealthController],
})
export class AppModule {}
