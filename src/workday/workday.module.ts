import { Module } from '@nestjs/common';
import { WorkdayClient } from './workday.client';

/**
 * Módulo do cliente Workday. Exporta o WorkdayClient para os jobs de
 * sincronização e para a descoberta de schema (Task 4).
 */
@Module({
  providers: [WorkdayClient],
  exports: [WorkdayClient],
})
export class WorkdayModule {}
