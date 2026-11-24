import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Response } from 'express';
import { SyncOrchestrator, SyncAlreadyRunningError } from './sync.orchestrator';
import { JobRegistry } from './job-registry';
import { SyncRunRepository } from '../persistence/sync-run.repository';

/**
 * Disparo sob demanda e consulta de execuções.
 *
 * - `POST /sync/:phase/:type` inicia uma sincronização em segundo plano e
 *   responde **202** com o id da run, sem esperar o fim. Acompanhe pelo
 *   `GET /sync/runs/:id` (os contadores sobem a cada item processado).
 *   Com `?wait=true`, espera o fim e responde **200** com o status final.
 *   Job já em andamento: **409**.
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
    return this.registry
      .list()
      .map((j) => ({ phase: j.phase, type: j.type, key: j.key }));
  }

  @Post(':phase/:type')
  async trigger(
    @Param('phase') phase: string,
    @Param('type') type: string,
    @Query('wait') wait: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const job = this.registry.get(phase, type);
    if (!job) {
      throw new NotFoundException(`Job não encontrado: ${phase}/${type}`);
    }
    try {
      if (wait === 'true') {
        const runId = await this.orchestrator.run(job, 'manual');
        const run = await this.runs.findById(runId);
        res.status(HttpStatus.OK);
        return { runId, phase, type, status: run?.status ?? null };
      }
      const runId = await this.orchestrator.launch(job, 'manual');
      res.status(HttpStatus.ACCEPTED);
      return {
        runId,
        phase,
        type,
        status: 'running',
        statusUrl: `/sync/runs/${runId}`,
      };
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
