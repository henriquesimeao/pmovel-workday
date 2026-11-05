import { Module } from '@nestjs/common';
import { PmovelClient } from './pmovel.client';

/**
 * Módulo do cliente Pmovel. Exporta o PmovelClient para os jobs de
 * sincronização (Fase 1 em diante).
 */
@Module({
  providers: [PmovelClient],
  exports: [PmovelClient],
})
export class PmovelModule {}
