import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';

/**
 * Módulo raiz da aplicação.
 *
 * À medida que as tasks avançam, os módulos de domínio (workday, pmovel,
 * persistence, mapping, sync, phases) serão importados aqui. Por ora, só a
 * configuração global e o health check (Task 1).
 */
@Module({
  imports: [AppConfigModule],
  controllers: [HealthController],
})
export class AppModule {}
