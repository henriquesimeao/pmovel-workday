import { Module } from '@nestjs/common';
import { SyncModule } from '../../sync/sync.module';
import { WorkdayModule } from '../../workday/workday.module';
import { PmovelModule } from '../../pmovel/pmovel.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { AppConfigService } from '../../config/app-config.service';
import { WorkdayClient } from '../../workday/workday.client';
import { PayrollExportJob } from './payroll-export.job';
import { PayrollExportPoller } from './payroll-export.poller';
import {
  PAYROLL_INPUT_WRITER,
  PayrollInputWriter,
} from './writers/payroll-input-writer';
import { SubmitPayrollInputWriter } from './writers/submit-payroll-input.writer';
import { ExternalPayrollInputWriter } from './writers/external-payroll-input.writer';

/**
 * Escolhe o gravador pelo destino configurado. Sem destino (envio desligado),
 * devolve um gravador que recusa, para o erro aparecer claro se for usado.
 */
export function payrollInputWriterFactory(
  config: AppConfigService,
  workday: WorkdayClient,
): PayrollInputWriter {
  switch (config.payrollExport.destination) {
    case 'payroll_input':
      return new SubmitPayrollInputWriter(workday);
    case 'external_payroll_input':
      return new ExternalPayrollInputWriter(workday);
    default:
      return {
        destination: 'none',
        upsert: () =>
          Promise.reject(
            new Error('PAYROLL_EXPORT_DESTINATION não configurado'),
          ),
      };
  }
}

/**
 * Fase 2: envio das verbas do ciclo (Pmovel → Workday), por solicitação do RH
 * no Pmovel. O job não fica no `JobRegistry` (não tem disparo HTTP): quem o
 * executa é o `PayrollExportPoller`.
 */
@Module({
  imports: [SyncModule, WorkdayModule, PmovelModule, PersistenceModule],
  providers: [
    {
      provide: PAYROLL_INPUT_WRITER,
      inject: [AppConfigService, WorkdayClient],
      useFactory: payrollInputWriterFactory,
    },
    PayrollExportJob,
    PayrollExportPoller,
  ],
})
export class PayrollExportModule {}
