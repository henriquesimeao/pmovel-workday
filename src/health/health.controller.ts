import { Controller, Get } from '@nestjs/common';

/**
 * Endpoint de liveness básico.
 * Observabilidade mais rica (readiness, métricas) fica para fases futuras —
 * por ora, só logs e um health check simples, conforme combinado.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
