import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { SyncOrchestrator, SyncAlreadyRunningError } from './sync.orchestrator';
import { JobRegistry } from './job-registry';
import { SyncRunRepository } from '../persistence/sync-run.repository';

/**
 * Disparo sob demanda e consulta de execuções.
 *
 * - `POST /sync/:phase/:type` inicia uma sincronização e devolve o id da run.
 * - `GET /sync/runs/:id` retorna a run com seus itens (resultado detalhado).
 * - `GET /sync/jobs` lista os jobs registrados.
 */
@Controller('sync')
export class SyncController {
  constructor(
    private readonly orchestrator: SyncOrchestrator,
    private readonly registry: JobRegistry,
    private readonly runs: SyncRunRepository,
  ) {}

  @Get('jobs')
  listJobs() {
    return this.registry.list().map((j) => ({ phase: j.phase, type: j.type, key: j.key }));
  }

  @Post(':phase/:type')
  async trigger(@Param('phase') phase: string, @Param('type') type: string) {
    const job = this.registry.get(phase, type);
    if (!job) {
      throw new NotFoundException(`Job não encontrado: ${phase}/${type}`);
    }
    try {
      const runId = await this.orchestrator.run(job, 'manual');
      return { runId, phase, type };
    } catch (e) {
      if (e instanceof SyncAlreadyRunningError) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Get('runs/:id')
  async getRun(@Param('id', ParseIntPipe) id: number) {
    const run = await this.runs.findById(id);
    if (!run) {
      throw new NotFoundException(`Run não encontrada: ${id}`);
    }
    return run;
  }
}
